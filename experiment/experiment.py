#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pos Energy Stress Test
"""

import argparse
import io
import json
import logging
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Tuple, List, Optional

import yaml

try:
    from poslib import api as pos
except ImportError:
    print("Could not import poslib. Activate your environment.",
          file=sys.stderr)
    sys.exit(1)


# ----------------------------- logging ------------------------------------ #

def setup_logging(verbose: bool) -> logging.Logger:
    """Configure logger."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # Silence HTTP chatter
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("requests").setLevel(logging.WARNING)
    return logging.getLogger("pos-exp")


# ----------------------------- helpers ------------------------------------ #

def sum_processor_counts(node_info: Dict[str, Any], key: str) -> int:
    """Sum cores/threads across sockets for legacy structures."""
    total = 0
    for pinfo in node_info.get("processor", []) or []:
        val = pinfo.get(key)
        if val is None and key == "threads":
            val = pinfo.get("cores", 0)
        total += int(val or 0)
    return total


def get_cpu_counts(node: str, log: logging.Logger) -> Tuple[int, int]:
    """Get total cores and threads for node (from pos.nodes.show)."""
    data, _ = pos.nodes.show(node)
    info = data.get(node, {})
    cores = sum_processor_counts(info, "cores")
    threads = sum_processor_counts(info, "threads")
    log.debug("Detected CPU topology: cores=%d threads=%d", cores, threads)
    return cores, threads


def make_series(n: int) -> List[int]:
    """Return [1..n]."""
    n = max(1, int(n or 1))
    return list(range(1, n + 1))


def _load_vars_from_path(path: str) -> Dict[str, Any]:
    """Load YAML/JSON file into dict."""
    ext = os.path.splitext(path)[1].lower()
    if ext in {".yaml", ".yml"}:
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def set_variables_from_path(node: str, path: str,
                            as_global: bool, as_loop: bool,
                            log: logging.Logger) -> None:
    """Send variables file to pos."""
    data = _load_vars_from_path(path)
    buf = io.BytesIO(json.dumps(data).encode("utf-8"))
    pos.allocations.set_variables(
        node,
        buf,
        extension="json",
        as_global=as_global,
        as_loop=as_loop,
        print_variables=False,
    )
    log.debug("Set variables from %s (global=%s loop=%s)",
              path, as_global, as_loop)


def set_inline_loop_variables(node: str, loop_vars: Dict[str, Any],
                              log: logging.Logger) -> None:
    """Send inline loop variables to pos."""
    buf = io.BytesIO(json.dumps(loop_vars).encode("utf-8"))
    pos.allocations.set_variables(
        node,
        buf,
        extension="json",
        as_global=False,
        as_loop=True,
        print_variables=False,
    )
    log.debug("Loop Vars: %s", loop_vars)


def run_infile(node: str, script_path: str, *,
               blocking: bool, name: str,
               loop: bool, log: logging.Logger) -> Any:
    """Run a script on node via infile."""
    log.info("Run %s", name)
    with open(script_path, "r", encoding="utf-8") as f:
        _, data = pos.commands.launch(
            node=node,
            infile=f,
            blocking=blocking,
            name=name,
            loop=loop,
        )
    return data


# ---------------------- manifest extraction utils ------------------------- #

def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _extract_author_from_rocrate(crate: Dict[str, Any]) -> Dict[str, Any]:
    """
    Pull a 'Person' from RO-Crate. Prefer tags ['author','main_author'],
    else any 'author', else first Person. Normalize fields.
    """
    graph = crate.get("@graph", []) if isinstance(crate, dict) else []
    persons: List[Dict[str, Any]] = [
        x for x in graph if isinstance(x, dict) and x.get("@type") == "Person"
    ]

    def tags(p: Dict[str, Any]) -> List[str]:
        return [t.lower() for t in (p.get("tags") or [])]

    pick = (next((p for p in persons
                  if {"author", "main_author"} <= set(tags(p))), None)
            or next((p for p in persons if "author" in tags(p)), None)
            or (persons[0] if persons else None))

    if not pick:
        return {}

    display = (pick.get("name") or
               " ".join(filter(None, [pick.get("givenName"),
                                      pick.get("familyName")])))
    alt = pick.get("alternateName") or ""
    handle = (alt or (display.split(" ")[-1].lower() if display else ""))

    aff = pick.get("affiliation") or {}
    aff_name = pick.get("affiliation_name", "")
    aff_ror = pick.get("affiliation_ror", "")
    if not aff_ror and isinstance(aff, dict):
        aff_id = aff.get("@id", "")
        if isinstance(aff_id, str) and "ror.org" in aff_id:
            aff_ror = aff_id

    return {
        "display_name": display or handle or "unknown",
        "handle": handle or "unknown",
        "orcid": pick.get("@id", "") if "orcid.org" in str(pick.get("@id"))
        else "",
        "affiliation_name": aff_name,
        "affiliation_ror": aff_ror,
    }


def _extract_processors_from_hw(hw: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Normalize processors list from hardware.json. If missing, synthesize one
    from flat keys so totals still work.
    """
    if not isinstance(hw, dict):
        return []

    procs = hw.get("processor")
    if isinstance(procs, list) and procs:
        out: List[Dict[str, Any]] = []
        for p in procs:
            if not isinstance(p, dict):
                continue
            out.append({
                "slot": p.get("slot") or p.get("id") or "CPU",
                "vendor": p.get("vendor") or p.get("manufacturer") or "",
                "model": (p.get("model") or p.get("name") or
                          hw.get("cpu_model") or ""),
                "cores": int(p.get("cores") or 0),
                "threads": int(p.get("threads") or p.get("cores") or 0),
                "architecture": (p.get("architecture") or
                                 hw.get("architecture") or "x86_64"),
            })
        return out

    return [{
        "slot": "CPU",
        "vendor": hw.get("vendor") or hw.get("cpu_vendor") or "",
        "model": hw.get("model") or hw.get("cpu_model") or "",
        "cores": int(hw.get("cores") or hw.get("cpu_cores") or 0),
        "threads": int(hw.get("threads") or hw.get("cpu_threads") or
                       hw.get("cores") or hw.get("cpu_cores") or 0),
        "architecture": hw.get("architecture") or "x86_64",
    }]


def _read_metrics(result_dir: Path) -> Dict[str, Any]:
    """Read energy/metrics.json if present."""
    mpath = result_dir / "energy" / "metrics.json"
    data = _read_json(mpath)
    if isinstance(data, dict):
        return {
            "avg_power_w": data.get("avg_power_w"),
            "peak_power_w": data.get("peak_power_w"),
            "energy_wh": data.get("energy_wh"),
        }
    return {}


# ------------------------------- main ------------------------------------- #

def main() -> int:
    """Main entry."""
    parser = argparse.ArgumentParser()
    parser.add_argument("loadgen", help="Load generator node")
    parser.add_argument("--experiment-name", default="stress-energy")
    parser.add_argument("--global-vars", default="variables/global.yml")
    parser.add_argument("--image", default="debian-trixie")
    parser.add_argument("--bootparam", action="append", default=["iommu=pt"])
    parser.add_argument("--enable-hyperthreading", action="store_true",
                        help="If set, loop over threads instead of cores.")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--zenodo-token-file",
                        default=os.path.expanduser(
                            "~/.secrets/zenodo_sandbox_token"))
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    log = setup_logging(args.verbose)
    log.info("Starting %s on node %s",
             args.experiment_name, args.loadgen)

    log.info("Free allocation")
    pos.allocations.free(args.loadgen)

    log.info("Allocate node")
    alloc_id, _, result_folder = pos.allocations.allocate([args.loadgen])
    log.debug("Allocation ID: %s", alloc_id)
    log.debug("Result folder: %s", result_folder)

    # Loop sizing based on flag (threads vs cores)
    cores, threads = get_cpu_counts(args.loadgen, log)
    use = threads if args.enable_hyperthreading and threads else cores
    loop_vars = {"cores": make_series(use)}

    log.info("Set global variables: %s", args.global_vars)
    set_variables_from_path(args.loadgen, args.global_vars,
                            as_global=True, as_loop=False, log=log)

    log.info("Set loop variables")
    set_inline_loop_variables(args.loadgen, loop_vars, log)

    log.info("Apply image: %s", args.image)
    pos.nodes.image(args.loadgen, args.image)

    joined = " ".join(args.bootparam)
    log.info("Apply boot params: %s", joined)
    pos.nodes.bootparameters(args.loadgen, joined, delete=False)

    log.info("Reboot node (blocking)")
    pos.nodes.reset(args.loadgen, blocking=True)

    setup_script = os.path.join("loadgen", "setup.sh")
    run_infile(args.loadgen, setup_script, blocking=True,
               name="setup", loop=False, log=log)

    exp_script = os.path.join("loadgen", "loadgen.sh")
    run_infile(args.loadgen, exp_script, blocking=True,
               name="energy-stress-test", loop=True, log=log)

    # Visuals + (usually) metrics.json
    log.info("Creating Energy Visualization")
    pos.energy.visualize(
        result_dir=result_folder,
        plots=["power", "bar", "current", "voltage"],
        img_format="png",
        runs=None,
    )

    # ---------------- Build manifest ---------------- #
    rdir = Path(result_folder)
    run_id = Path(result_folder).name
    created_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

    # RO-Crate author (best effort)
    crate = _read_json(rdir / "ro-crate-metadata.json") or {}
    author = _extract_author_from_rocrate(crate)

    # Derive username then remove 'handle' from author
    username = (author.get("handle") or author.get("display_name")
                or "unknown")
    author.pop("handle", None)

    # Hardware per-node
    cfg_dir = rdir / "config" / args.loadgen
    hw_json = _read_json(cfg_dir / "hardware.json") or {}
    processors = _extract_processors_from_hw(hw_json or {})

    # Metrics (from visualizer)
    metrics = _read_metrics(rdir)

    manifest: Dict[str, Any] = {
        "run_id": run_id,
        "node": args.loadgen,
        "created": created_iso,
        "username": username,
        "author": author,
        "processor": processors,
        "threading_enabled": bool(args.enable_hyperthreading),
        "metrics": metrics,
        "zenodo_html": "",
    }

    deposition_link = None
    if args.publish:
        rf_path = f"/srv/testbed/results/{result_folder}"
        log.info("Publishing results to Zenodo")
        log.debug("Using Zenodo Token from %s", args.zenodo_token_file)
        with open(args.zenodo_token_file, "r", encoding="utf-8") as f:
            token = f.read().strip()
        deposition_link = pos.results.upload(
            result_folder=rf_path,
            allocation_id=alloc_id,
            access_token=token,
            publish=False,
            deposition_id=None,
            title=None,
            description=None,
            license="CC-BY-4.0",
            access_right="open",
        )
        log.info("Published to Zenodo: %s", deposition_link)
        manifest["zenodo_html"] = deposition_link or ""

    # ---------------- Write submission into repo ---------------- #
    repo_root = Path(__file__).resolve().parents[1]  # pos-blueprint/
    sub_dir = repo_root / "submission" / username / run_id
    sub_energy = sub_dir / "energy"
    sub_dir.mkdir(parents=True, exist_ok=True)
    sub_energy.mkdir(parents=True, exist_ok=True)

    # Write manifest.json
    with (sub_dir / "manifest.json").open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    log.debug("Wrote submission manifest: %s", sub_dir / "manifest.json")

    # Copy plots
    src_energy = rdir / "energy"
    wanted = [
        "power-over-time.png",
        "total-energy-per-node.png",
        "current-over-time.png",
        "smoothed-voltage.png",
    ]
    for name in wanted:
        src = src_energy / name
        dst = sub_energy / name
        if src.exists():
            shutil.copy2(src, dst)
            log.debug("Copied plot: %s", dst)
        else:
            log.warning("Missing plot (skip): %s", src)

    log.info("Created new submission")

    # TODO: Add automatic push to repo (git)

    return 0


if __name__ == "__main__":
    sys.exit(main())
