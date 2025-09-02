#!/usr/bin/env python3
"""
Build docs/leaderboard.json from submission/<user>/<run_id> (manifest-only).
"""

import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional

import requests


OWNER = os.environ.get("GITHUB_REPOSITORY", "").split("/")[0]
REPO = os.environ.get("GITHUB_REPOSITORY", "").split("/")[-1]
BRANCH = os.environ.get("GITHUB_REF_NAME", "main")
GH_TOKEN = os.environ.get("GITHUB_TOKEN", "")
API = "https://api.github.com"

HEAD = {"Accept": "application/vnd.github+json"}
if GH_TOKEN:
    HEAD["Authorization"] = f"Bearer {GH_TOKEN}"
HEAD["X-GitHub-Api-Version"] = "2022-11-28"


def gh_contents(path: str) -> Any:
    """Get the contents of a GitHub repository directory."""
    url = f"{API}/repos/{OWNER}/{REPO}/contents/{path}"
    params = {"ref": BRANCH}
    r = requests.get(url, headers=HEAD, params=params, timeout=30)
    if r.status_code == 404:
        return []
    r.raise_for_status()
    return r.json()


def list_runs(root: str = "submission") -> List[Dict[str, str]]:
    """List all runs in the specified root directory."""
    runs: List[Dict[str, str]] = []
    for user in gh_contents(root):
        if user.get("type") != "dir":
            continue
        user_path = f"{root}/{user['name']}"
        for run in gh_contents(user_path):
            if run.get("type") == "dir":
                runs.append({
                    "user": user["name"],
                    "path": f"{user_path}/{run['name']}",
                })
    return runs


def download_url_for(path: str) -> Optional[str]:
    """Get the download URL for a file in the repository."""
    js = gh_contents(path)
    if isinstance(js, dict) and "download_url" in js:
        return js["download_url"]
    return None


def read_manifest(path: str) -> Dict[str, Any]:
    """Read the manifest.json file."""
    url = download_url_for(path)
    if not url:
        return {}
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    try:
        return r.json()
    except Exception:
        return {}


def summarize(manifest: Dict[str, Any],
              run: Dict[str, str]) -> Dict[str, Any]:
    """Summarize the run information."""
    author = manifest.get("author") or {}
    user = manifest.get("username") or run["user"]
    user_display = (author.get("display_name") or author.get("name") or
                    author.get("alternateName") or user)
    handle = author.get("handle") or author.get("alternateName") or user

    procs = manifest.get("processor") or []
    label = "unknown"
    total_cores = 0
    total_threads = 0
    if isinstance(procs, list) and procs:
        first = procs[0] or {}
        label = " ".join([first.get("vendor", ""),
                          first.get("model", "")]).strip() or "unknown"
        for p in procs:
            total_cores += int(p.get("cores") or 0)
            total_threads += int(p.get("threads") or 0)

    ht = manifest.get("threading_enabled")
    ht_badge = ""
    if isinstance(ht, bool) and not ht:
        ht_badge = " (HT off)"

    metrics = manifest.get("metrics") or {}
    avgw = metrics.get("avg_power_w")
    peakw = metrics.get("peak_power_w")
    ewh = metrics.get("energy_wh")

    want = [
        "power-over-time.png",
        "total-energy-per-node.png",
        "current-over-time.png",
        "smoothed-voltage.png",
    ]
    images: List[str] = []
    energy_dir = f"{run['path']}/energy"
    by_lower: Dict[str, str] = {}
    for ent in gh_contents(energy_dir):
        if ent.get("type") == "file" and ent["name"].lower().endswith(".png"):
            by_lower[ent["name"].lower()] = ent.get("download_url")
    for name in want:
        images.append(by_lower.get(name, ""))

    return {
        "id": manifest.get("run_id") or run["path"].split("/")[-1],
        "user": handle,
        "user_display": user_display,
        "affiliation_name": author.get("affiliation_name", ""),
        "affiliation_ror": author.get("affiliation_ror", ""),
        "cpu_label": label,
        "cores": total_cores,
        "threads": total_threads,
        "ht_badge": ht_badge,
        "avg_power_w": avgw,
        "peak_power_w": peakw,
        "energy_wh": ewh,
        "created": manifest.get("created", ""),
        "zenodo": manifest.get("zenodo_html", ""),
        "images": images,
        "node": manifest.get("node", ""),
    }


def main() -> int:
    """Main entry point."""
    runs = list_runs()
    out = {"runs": []}
    for r in runs:
        manifest = read_manifest(f"{r['path']}/manifest.json")
        if not manifest:
            continue
        out["runs"].append(summarize(manifest, r))

    out_path = Path("docs/leaderboard.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"Wrote {out_path} with {len(out['runs'])} runs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
