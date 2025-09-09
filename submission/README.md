# POS Energy Blueprint — `submission/`

This folder contains **leaderboard submissions**. Each submission is a single run created by the pos daemon (`/energy/submit`) or by the CI importer, and is fully described by its `manifest.json` plus four energy plots in `energy/`.

---

## Folder layout

```text
 submission
├──  <username>/
│  └──  <run_id>/
│     ├──  energy/
│     │  ├── current-over-time.png
│     │  ├── power-over-time.png
│     │  ├── smoothed-voltage.png
│     │  ├── total-energy-per-node.png
│     │  └── metrics.json              # written by visualize; optional but recommended
│     └── manifest.json                # required; all metadata consolidated here
```

### Rules

- Exactly **one run** per `<run_id>` folder.
- Only two items at the top level of a run folder:
  - `manifest.json`
  - `energy/` (with the four PNG plots; optional `metrics.json`)
- No additional files at the top level to keep the repo tidy.

---

## `manifest.json` schema (required)

All information required by the website lives here. The daemon tries to build this from the RO-Crate (`ro-crate-metadata.json`) and hardware JSON on submit.

### Required fields

- `run_id` : string — unique run identifier (e.g., folder name)
- `node` : string — node name used for the run (e.g., `vilnius`)
- `created` : ISO 8601 timestamp (UTC preferred)
- `username` : string — submitter’s short handle (used for folder name)
- `author` : object — human info (see below)
- `processor` : array of objects — one per socket/CPU
- `threading_enabled` : boolean — SMT/HT status during the run
- `metrics` : object — energy metrics (see below)

### Optional fields

- `zenodo_html` : string (URL) — deposition link if published to Zenodo

### `author` object

- `display_name` : string — preferred name for display
- `handle` : string — short identifier (e.g., GitHub/pos handle); also used for folder name
- `orcid` : string (URL) — ORCID if available
- `affiliation_name` : string — e.g., “Technical University of Munich”
- `affiliation_ror` : string (URL) — ROR link if available

### `processor[]` (per socket)

- `slot` : string — e.g., “CPU”, “CPU0”
- `vendor` : string — e.g., “Intel”, “AMD”
- `model` : string — e.g., “Xeon E31230 @ 3.20GHz”
- `cores` : integer — physical cores on this socket
- `threads` : integer — logical threads on this socket
- `architecture` : string — e.g., “x86_64”, “64bit”
- other pass-through keys from hardware JSON are allowed (e.g., `microcode`, `version`, `virtualized`)

### `metrics`

- `avg_power_w` : number — average active power (W)
- `peak_power_w` : number — peak active power (W)
- `energy_wh` : number — total energy (Wh) for the run (daemon computes from counters)

---

## Example `manifest.json`

```json
{
  "run_id": "2025-09-08_23-50-33_725000",
  "node": "vilnius",
  "created": "2025-09-08T22:01:27.124829+00:00",
  "username": "warmuth",
  "author": {
    "display_name": "Kilian Warmuth",
    "handle": "warmuth",
    "orcid": "<https://orcid.org/0000-0001-6328-1047>",
    "affiliation_name": "Technical University of Munich",
    "affiliation_ror": "<https://ror.org/02kkvpp62>"
  },
  "processor": [
    {
      "slot": "CPU",
      "cores": 4,
      "model": "Xeon E31230 @ 3.20GHz",
      "vendor": "Intel",
      "threads": 8,
      "version": "6.42.7",
      "microcode": "41",
      "virtualized": false,
      "architecture": "64bit"
    }
  ],
  "threading_enabled": false,
  "metrics": {
    "avg_power_w": 91.1,
    "peak_power_w": 115.0,
    "energy_wh": 10.0
  },
  "zenodo_html": "<https://sandbox.zenodo.org/deposit/327654>"
}
```

---

## Validation checklist

Before opening a PR (or when the daemon creates one):

- [ ] `manifest.json` present and valid JSON
- [ ] `energy/` contains all four PNG plots
- [ ] `metrics.json` present (recommended)
- [ ] `username` folder name matches `manifest.username`
- [ ] `run_id` folder name matches `manifest.run_id`
- [ ] `threading_enabled` reflects the run setup
- [ ] Only `manifest.json` and `energy/` at the top level of the run

---

## How the website reads this

The CI builds `docs/leaderboard.json` from `submission/**/manifest.json` (and `energy/metrics.json` if present). The static site (GitHub Pages) reads only that JSON — no live GitHub API calls — so once your PR is merged, your run appears automatically.

---
