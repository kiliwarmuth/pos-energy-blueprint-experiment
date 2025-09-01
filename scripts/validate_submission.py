#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate submission packs under submission/<user>/<run_id>/.

Checks:
- required files exist
- PNGs are images, <= 5 MB each
- manifest.json matches schema and safe strings
- optional hardware.json parsed if present
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple

from jsonschema import Draft7Validator
from PIL import Image


MAX_PNG_MB = 5
RE_USER = re.compile(r"^[a-z0-9._-]{1,40}$")
RE_RUN = re.compile(r"^[a-zA-Z0-9._:-]{1,80}$")

MANIFEST_SCHEMA: Dict = {
    "type": "object",
    "properties": {
        "username": {"type": "string"},
        "run_id": {"type": "string"},
        "created": {"type": "string"},
        "zenodo_html": {"type": "string"},
        "metrics": {
            "type": "object",
            "properties": {
                "avg_power_w": {"type": ["number", "integer"]},
                "peak_power_w": {"type": ["number", "integer"]},
                "energy_wh": {"type": ["number", "integer"]},
            },
            "additionalProperties": True,
        },
    },
    "required": ["username", "run_id"],
    "additionalProperties": True,
}


def fail(msg: str) -> None:
    print(f"::error::{msg}")
    raise SystemExit(1)


def validate_png(path: Path) -> None:
    if not path.exists():
        fail(f"Missing PNG: {path}")
    size_mb = path.stat().st_size / (1024 * 1024)
    if size_mb > MAX_PNG_MB:
        fail(f"PNG too large (> {MAX_PNG_MB} MB): {path}")
    try:
        with Image.open(path) as im:
            im.verify()
    except Exception as exc:  # noqa: BLE001
        fail(f"Invalid PNG {path}: {exc}")


def validate_manifest(path: Path) -> Dict:
    if not path.exists():
        fail(f"Missing manifest.json at {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        fail(f"manifest.json not valid JSON: {exc}")

    errs = sorted(Draft7Validator(MANIFEST_SCHEMA).iter_errors(data),
                  key=str)
    if errs:
        for e in errs:
            print(f"::error::manifest schema: {e.message}")
        fail("manifest schema validation failed")

    user = data["username"]
    run = data["run_id"]
    if not RE_USER.match(user):
        fail(f"username has invalid characters: {user}")
    if not RE_RUN.match(run):
        fail(f"run_id has invalid characters: {run}")

    return data


def scan_submissions(root: Path) -> List[Tuple[Path, str, str]]:
    pairs: List[Tuple[Path, str, str]] = []
    if not root.exists():
        return pairs
    for user_dir in root.iterdir():
        if not user_dir.is_dir():
            continue
        user = user_dir.name
        for run_dir in user_dir.iterdir():
            if run_dir.is_dir():
                pairs.append((run_dir, user, run_dir.name))
    return pairs


def main() -> int:
    repo = Path(".").resolve()
    sub_root = repo / "submission"
    runs = scan_submissions(sub_root)
    if not runs:
        print("No submissions found; nothing to validate.")
        return 0

    for run_dir, user, run in runs:
        print(f"Validating {user}/{run}")
        # manifest
        manifest = validate_manifest(run_dir / "manifest.json")
        if manifest["username"] != user:
            fail("manifest.username does not match folder name")
        if manifest["run_id"] != run:
            fail("manifest.run_id does not match folder name")

        # required pngs
        energy = run_dir / "energy"
        validate_png(energy / "power-over-time.png")
        validate_png(energy / "total-energy-per-node.png")
        validate_png(energy / "current-over-time.png")
        validate_png(energy / "smoothed-voltage.png")

        # optional hardware.json
        cfg_dir = run_dir / "config"
        if cfg_dir.exists():
            nodes = [p for p in cfg_dir.iterdir() if p.is_dir()]
            if nodes:
                hw = nodes[0] / "hardware.json"
                if hw.exists():
                    # parse once to ensure valid JSON
                    try:
                        json.loads(hw.read_text(encoding="utf-8"))
                    except Exception as exc:  # noqa: BLE001
                        fail(f"hardware.json invalid JSON: {exc}")

    print("All submissions validated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
