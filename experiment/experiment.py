#!/usr/bin/env python3
"""
pos Energy Blueprint Stress Experiment
"""

import argparse
import io
import json
import logging
import os
import sys
from pathlib import Path
from typing import Dict, Any, Tuple, List

import yaml

try:
    from poslib import api as pos
    from poslib import restapi
except ImportError:
    print(
        "Could not import poslib. Activate your environment.",
        file=sys.stderr,
    )
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
    # Mute libraries
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


def set_variables_from_path(
    node: str,
    path: str,
    as_global: bool,
    as_loop: bool,
    log: logging.Logger,
) -> None:
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
    log.debug(
        "Set variables from %s (global=%s loop=%s)",
        path,
        as_global,
        as_loop,
    )


def set_inline_loop_variables(
    node: str,
    loop_vars: Dict[str, Any],
    log: logging.Logger,
) -> None:
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


def run_infile(
    node: str,
    script_path: str,
    *,
    blocking: bool,
    name: str,
    loop: bool,
    log: logging.Logger,
) -> Any:
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


# ------------------------------- main ------------------------------------- #

def main() -> int:
    """Main entry."""
    parser = argparse.ArgumentParser()
    parser.add_argument("loadgen", help="Load generator node")
    parser.add_argument("--experiment-name", default="stress-energy")
    parser.add_argument("--global-vars", default="variables/global.yml")
    parser.add_argument("--image", default="debian-bookworm")
    parser.add_argument("--bootparam", action="append", default=["iommu=pt"])
    parser.add_argument(
        "--enable-hyperthreading",
        action="store_true",
        help="If set, loop over threads instead of cores.",
    )
    parser.add_argument("--publish", action="store_true")
    parser.add_argument(
        "--zenodo-token-file",
        default=os.path.expanduser("~/.secrets/zenodo_sandbox_token"),
    )
    parser.add_argument(
        "--submit",
        action="store_true",
        help="Request daemon to publish this run",
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    log = setup_logging(args.verbose)
    log.info("Starting %s on node %s", args.experiment_name, args.loadgen)

    # Preflight checks
    global_vars_path = Path(os.path.expanduser(args.global_vars))
    if not global_vars_path.exists():
        log.error("Global vars file not found: %s", global_vars_path)
        return 2

    setup_script_p = Path("loadgen") / "setup.sh"
    exp_script_p = Path("loadgen") / "loadgen.sh"
    for pth in (setup_script_p, exp_script_p):
        if not pth.exists():
            log.error("Script not found: %s", pth)
            return 2

    log.info("Free allocation")
    try:
        pos.allocations.free(args.loadgen)
    except restapi.RESTError as e:
        log.warning(
            "Free before allocate failed: %s",
            e,
            exc_info=args.verbose,
        )

    log.info("Allocate node")
    try:
        alloc_id, _, result_folder = pos.allocations.allocate(
            [args.loadgen]
        )
    except restapi.RESTError as e:
        log.error("Allocation failed: %s", e, exc_info=args.verbose)
        return 1
    log.debug("Allocation ID: %s", alloc_id)
    log.debug("Result folder: %s", result_folder)

    # Loop sizing based on flag (threads vs cores)
    cores, threads = get_cpu_counts(args.loadgen, log)
    use = threads if args.enable_hyperthreading and threads else cores
    if args.enable_hyperthreading and not threads:
        log.warning("HT requested but no thread count; using cores.")
    loop_vars = {"cores": make_series(use)}

    log.info("Set global variables: %s", global_vars_path)
    try:
        set_variables_from_path(
            args.loadgen,
            str(global_vars_path),
            as_global=True,
            as_loop=False,
            log=log,
        )
    except restapi.RESTError as e:
        log.error(
            "Setting global variables failed: %s",
            e,
            exc_info=args.verbose,
        )
        return 1

    log.info("Set loop variables")
    try:
        set_inline_loop_variables(args.loadgen, loop_vars, log)
    except restapi.RESTError as e:
        log.error(
            "Setting loop variables failed: %s",
            e,
            exc_info=args.verbose,
        )
        return 1

    log.debug("Apply image: %s", args.image)
    try:
        pos.nodes.image(args.loadgen, args.image)
    except restapi.RESTError as e:
        log.error("Image apply failed: %s", e, exc_info=args.verbose)
        return 1

    # Boot params (deduplicate preserving order)
    seen = set()
    bootparams: List[str] = []
    for bp in args.bootparam:
        if bp not in seen:
            bootparams.append(bp)
            seen.add(bp)

    log.debug("Apply boot params: %s", bootparams)
    try:
        pos.nodes.bootparameters(args.loadgen, bootparams, delete=False)
    except restapi.RESTError as e:
        log.error("Boot param apply failed: %s", e, exc_info=args.verbose)
        return 1

    log.info("Reboot node (blocking)")
    try:
        pos.nodes.reset(args.loadgen, blocking=True)
    except restapi.RESTError as e:
        log.error("Reboot failed: %s", e, exc_info=args.verbose)
        return 1

    try:
        run_infile(
            args.loadgen,
            str(setup_script_p),
            blocking=True,
            name="setup",
            loop=False,
            log=log,
        )
    except restapi.RESTError as e:
        log.error("Setup script failed: %s", e, exc_info=args.verbose)
        return 1

    try:
        run_infile(
            args.loadgen,
            str(exp_script_p),
            blocking=True,
            name="energy-stress-test",
            loop=True,
            log=log,
        )
    except restapi.RESTError as e:
        log.error("Experiment run failed: %s", e, exc_info=args.verbose)
        return 1

    # Update RO-Crate metadata
    log.info("Updating RO-Crate metadata")
    try:
        title = "Energy Blueprint Stress Experiment"
        ht_clause = (
            "When hyperthreading is enabled, logical threads are "
            "stressed as well."
            if args.enable_hyperthreading
            else "Hyperthreading is disabled; only physical cores "
                 "are stressed."
        )
        desc = (
            f"Energy blueprint experiment on node {args.loadgen} "
            f"using image {args.image}. This run measures the node's "
            "energy consumption by running the Linux 'stress' command "
            f"on each CPU core. {ht_clause}"
        )
        keywords = [
            "energy",
            "power",
            "voltage",
            "current",
            "blueprint",
            "benchmark",
            "experiment",
            "testbed",
            "reproducibility",
            "ro-crate",
        ]
        keywords = ",".join(keywords)

        pos.results.modify_metadata(
            result_folder=result_folder,
            allocation_id=None,
            action="add_title",
            data={"title": title},
        )
        pos.results.modify_metadata(
            result_folder=result_folder,
            allocation_id=None,
            action="add_description",
            data={"description": desc},
        )
        pos.results.modify_metadata(
            result_folder=result_folder,
            allocation_id=None,
            action="add_keywords",
            data={"keywords": keywords},
        )
        pos.results.modify_metadata(
            result_folder=result_folder,
            allocation_id=None,
            action="add_license",
            data={"license": "CC-BY-4.0"},
        )
        log.debug(
            "Metadata updated: title, description, keywords, license."
        )
    except restapi.RESTError as e:
        log.error("Metadata update failed: %s", e, exc_info=args.verbose)

    # Create energy plots
    log.info("Creating Energy Plots")
    try:
        pos.energy.visualize(
            result_dir=result_folder,
            plots=["power_rel", "bar", "current", "voltage"],
            img_format="png",
            runs=None,
        )
    except restapi.RESTError as e:
        log.error("Plot creation failed: %s", e, exc_info=args.verbose)

    # Publish to Zenodo
    deposition_link = None
    if args.publish:
        rf_path = os.path.join("/srv/testbed/results", str(result_folder))
        log.info("Publishing results to Zenodo")

        token: str | None = None
        token_file = os.path.expanduser(args.zenodo_token_file)
        try:
            if os.path.exists(token_file):
                log.debug("Using Zenodo token file: %s", token_file)
                with open(token_file, "r", encoding="utf-8") as f:
                    token = f.read().strip()
        except OSError as e:
            log.error(
                "Failed reading token file: %s",
                e,
                exc_info=args.verbose,
            )

        if not token:
            env_tok = os.environ.get("ZENODO_ACCESS_TOKEN", "").strip()
            if env_tok:
                log.debug("Using ZENODO_ACCESS_TOKEN from env")
                token = env_tok

        if not token:
            log.error(
                "No Zenodo token. Provide --zenodo-token-file or set "
                "ZENODO_ACCESS_TOKEN. Skipping publish."
            )
        else:
            try:
                deposition_link = pos.results.upload(
                    result_folder=rf_path,
                    allocation_id=alloc_id,
                    access_token=token,
                    publish=True,
                    deposition_id=None,
                    title=None,
                    description=None,
                    license="CC-BY-4.0",
                    access_right="open",
                )
                log.info("Published to Zenodo: %s", deposition_link)
            except restapi.RESTError as e:
                log.error(
                    "Publication failed: %s",
                    e,
                    exc_info=args.verbose,
                )

    log.info("Results at: %s", result_folder)

    # Publish submission to leaderboard
    if args.submit:
        try:
            pos.energy.submit(
                result_dir=result_folder,
                threading_enabled=bool(args.enable_hyperthreading),
                zenodo_html=deposition_link or None,
            )
            log.info("Submission request sent to daemon.")
        except restapi.RESTError as e:
            log.error("Submit failed: %s", e, exc_info=args.verbose)

    return 0


if __name__ == "__main__":
    sys.exit(main())
