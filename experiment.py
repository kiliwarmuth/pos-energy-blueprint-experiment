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
import sys
from typing import Dict, Any, Tuple, List
import yaml

try:
    from poslib import api as pos
except ImportError:
    print("Could not import poslib. Activate your environment.",
          file=sys.stderr)
    sys.exit(1)


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


def sum_processor_counts(node_info: Dict[str, Any], key: str) -> int:
    """Sum cores/threads across sockets."""
    total = 0
    for pinfo in node_info.get("processor", []) or []:
        val = pinfo.get(key)
        if val is None and key == "threads":
            val = pinfo.get("cores", 0)
        total += int(val or 0)
    return total


def get_cpu_counts(node: str, log: logging.Logger) -> Tuple[int, int]:
    """Get total cores and threads for node."""
    data, _ = pos.nodes.show(node)
    info = data.get(node, {})
    cores = sum_processor_counts(info, "cores")
    threads = sum_processor_counts(info, "threads")
    log.debug("Detected CPU topology: cores=%d threads=%d", cores, threads)
    return cores, threads


def make_series(n: int) -> List[int]:
    """Return [1..n]."""
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
    """Send variables file to POS."""
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
    """Send inline loop variables to POS."""
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


def main() -> int:
    """Main entry."""
    parser = argparse.ArgumentParser()
    parser.add_argument("loadgen", help="Load generator node")
    parser.add_argument("--experiment-name", default="stress-energy")
    parser.add_argument("--global-vars", default="variables/global.yml")
    parser.add_argument("--loop-dimension", choices=["cores", "threads"],
                        default="cores")
    parser.add_argument("--loop-max", type=int, default=None)
    parser.add_argument("--image", default="debian-trixie")
    parser.add_argument("--bootparam", action="append", default=["iommu=pt"])
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

    # log.info("Detect CPU topology")
    cores, threads = get_cpu_counts(args.loadgen, log)
    count = threads if args.loop_dimension == "threads" else cores
    if args.loop_max:
        count = min(count, args.loop_max)
    loop_vars = {"cores": make_series(count)}
    log.debug("Set Loop Variables: %s", loop_vars)

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
               name="setup",
               loop=False, log=log)

    exp_script = os.path.join("loadgen", "loadgen.sh")
    run_infile(args.loadgen, exp_script, blocking=True,
               name="energy-stress-test",
               loop=True, log=log)

    log.info("Creating Energy Visualization")
    pos.energy.visualize(
            result_dir=result_folder,
            plots=["power", "bar", "current", "voltage"],
            img_format="png",
            runs=None,
        )

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

    return 0


if __name__ == "__main__":
    sys.exit(main())
