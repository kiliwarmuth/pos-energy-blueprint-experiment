# `scripts/` — Helpers for the POS Energy Blueprint

This folder contains two utilities used by CI and maintainers:

- **`build_leaderboard_index.py`** — scans `submission/**/manifest.json` on the default branch and writes `docs/leaderboard.json` for the static website.
- **`validate_submission.py`** — checks that each submission has the required files and a valid `manifest.json`.

Both scripts are safe to run locally and are called by GitHub Actions on pushes/PRs.

---

## `build_leaderboard_index.py`

**Purpose**
Build a compact index the site can read without hitting the GitHub API from the browser.

### What it does

1. Lists all runs under `submission/<user>/<run_id>/`.
2. Fetches each run’s `manifest.json`.
3. Locates the four plot PNGs and (optionally) includes direct download URLs.
4. Emits `docs/leaderboard.json` with an array of runs (`{"runs":[...]}`).

### Input assumptions

- Tree structure:
  - `submission/<user>/<run_id>/manifest.json`
  - `submission/<user>/<run_id>/energy/*.png`
- `manifest.json` contains the fields described in the repo’s `submission/README.md`.

### Environment variables (CI-friendly)

```text
GITHUB_REPOSITORY  # "owner/repo" (required in CI)
GITHUB_REF_NAME    # branch name; defaults to "main"
GITHUB_TOKEN       # optional; increases API rate limits
```

> Locally, these are optional. The script defaults to `main` and anonymous API calls (subject to rate limiting).

### Output

```bash
docs/leaderboard.json
```

### Run locally

```bash
python scripts/build_leaderboard_index.py

# -> Wrote docs/leaderboard.json with N runs

```

### GitHub Actions

The workflow commits the generated JSON back to the repo when it changes and pages will serve it at

```text

https://<owner>.github.io/<repo>/leaderboard.json
```

---

## `validate_submission.py`

Fail fast if a submission is incomplete or malformed.

### What it checks

- **Presence & size of plots**
  Ensures these exist and are valid PNGs (≤ 5 MB each):
  - `energy/power-over-time.png`
  - `energy/total-energy-per-node.png`
  - `energy/current-over-time.png`
  - `energy/smoothed-voltage.png`
- **Manifest schema**
  Minimal JSON schema:
  - `username` (string), `run_id` (string) — **required**
  - `metrics.avg_power_w`, `metrics.peak_power_w`, `metrics.energy_wh` — optional numbers
  - Additional keys are allowed (e.g., `author`, `processor`, `threading_enabled`, `node`, `created`, `zenodo_html`).
- **Folder ↔ manifest consistency**
  - `<user>` folder matches `manifest.username`
  - `<run_id>` folder matches `manifest.run_id`
- **Optional `config/*/hardware.json`**
  If present, must parse as JSON.

### Constants

- Max PNG size: **5 MB**

### Run locally

```bash
python scripts/validate_submission.py

# -> prints validation per run; exits non-zero on first error

```

### Typical failures & fixes

- `Missing manifest.json`
  → Ensure the submit step or daemon wrote it, not just the plots.
- `PNG too large`
  → Reduce image size/dpi if your plotting step produced huge files.
- `manifest.username does not match folder name`
  → Rename folder or fix the `username` field in `manifest.json`.
- `manifest.run_id does not match folder name`
  → Align the run folder name and manifest value.

---

## How they work together in CI

1. On push/PR touching `submission/**`:
   - `validate_submission.py` runs first and fails the job if anything is wrong.
2. On push to `main`:
   - `build_leaderboard_index.py` runs and writes `docs/leaderboard.json`.
   - The workflow commits that file if it changed.

### Example workflow triggers (excerpt)

```yaml
on:
  push:
    branches: [ "main" ]
    paths:
      - "submission/**"
      - "scripts/build_leaderboard_index.py"
  pull_request:
    branches: [ "main" ]
    paths:
      - "submission/**"
      - "scripts/build_leaderboard_index.py"
```

---

## Implementation notes

- `build_leaderboard_index.py` calls the **GitHub Contents API** to read the repo tree and download raw `manifest.json`/PNG URLs. Supplying `GITHUB_TOKEN` avoids anonymous rate limits.
- `validate_submission.py` uses **`jsonschema`** for the minimal manifest check and **Pillow** (`PIL`) to verify PNGs; install them if you validate locally.
