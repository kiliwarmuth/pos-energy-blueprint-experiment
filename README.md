# pos Blueprint Leaderboard

This repository contains:

- the **energy stress test experiment** in [experiment/](./experiment)
- the **leaderboard submissions (results)** in [submission/](./submission)
- helper scripts in [scripts/](./scripts)
- the leaderboard logic in [docs/](./docs)

---

## Experiment

The experiment is designed to run on a pos testbed.

```bash
pos experiments execute experiment/config.yaml
```

This will:

- allocate and configure the node
- execute the Linux `stress` command to test different combinations of core utilization
- measure energy consumption
- produce result plots and metadata

For further details look at [experiment/](./experiment).

---

## Leaderboard

The leaderboard is deployed via **GitHub Pages** and available here:

[pos-energy-blueprint-leaderboard](https://kiliwarmuth.github.io/pos-energy-blueprint-experiment/)

Every experiment execution creates a new submission in the `submission/` folder.

```text
submission/
├── user/
│  └── 2025-09-02_10-47-47_182613/
│     ├── energy/
│     │  ├── current-over-time.png
│     │  ├── power-over-time.png
│     │  ├── smoothed-voltage.png
│     │  └── total-energy-per-node.png
│     └── manifest.json
```

- Each **user** has their own folder.
- Each **run** (submission) is stored in a timestamped subfolder.
- Each run must contain:
  - an `energy/` folder with 4 plots of the measured energy consumption
  - a `manifest.json` summarizing metadata about the run

---

### `manifest.json` contents

The manifest describes one run and contains:

- `run_id` — unique identifier for the run
- `author` — user information (name, handle, ORCID, affiliation)
- `processor[]` — hardware info (vendor, model, cores, threads …)
- `threading_enabled` — whether SMT/HyperThreading was active
- `metrics` — key energy values (avg power, peak power, total energy in Wh)
- `zenodo_html` — deposition link (if published to Zenodo)
- `created` — timestamp of the run

---

## Scripts

- `scripts/validate_submission.py`
  Validates that a submission is complete:
  - all 4 required plots exist
  - `manifest.json` is present and contains required fields

- `scripts/build_leaderboard_index.py`
  Builds a static JSON index (`docs/leaderboard.json`) consumed by the leaderboard website.
  This is executed automatically via GitHub Actions.

---

## Workflow

1. Run the experiment on the pos testbed.
2. A new folder under `submission/<username>/<run_id>/` is created:
   - `energy/` (the 4 plots)
   - `manifest.json` (metadata & metrics)
3. Commit and push this folder to the repository (or open a PR).
4. CI validates the submission and rebuilds `docs/leaderboard.json`.
5. GitHub Pages automatically updates the leaderboard site.

For further details look at [experiment/](./experiment).

---

## How to add a new submission

1. Fork or clone this repository.
2. Create your run folder:

   ```text
   submission/<your-username>/<run_id>/
     ├── energy/
     │   ├── current-over-time.png
     │   ├── power-over-time.png
     │   ├── smoothed-voltage.png
     │   └── total-energy-per-node.png
     └── manifest.json
   ```

3. Validate your submission locally:

   ```bash
   python scripts/validate_submission.py
   ```

4. Commit and push (or open a PR).
5. GitHub Actions will validate again and update the leaderboard.

For further details look at [experiment/](./experiment).
