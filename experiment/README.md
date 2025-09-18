# pos Energy Stress Test — `experiment/`

This folder contains a self-contained experiment that (1) allocates a pos node, (2) runs a CPU stress/energy measurement loop, (3) renders energy plots, and (optionally) (4) submits the run to the leaderboard repository via the pos daemon.

---

## Folder layout

```text
 experiment
├──  loadgen
│  ├── measurement.sh             # executes the actual experiment including the energy measurements
│  └── setup.sh                   # installs tools on the node (e.g., stress)
├──  variables
│  └── global.yml                 # parameters consumed by the scripts (e.g., runtime)
├── config.yaml                   # declarative entrypoint for `pos experiments execute`
└── experiment.py                 # Python driver (allocate → run → visualize → submit)
```

---

## Configuration

The `config.yaml` describes how the experiment is launched via `pos experiments execute`.

```yaml
experiment:
  entrypoint: "experiment.py"
  interpreter: "python3"
  args: "vilnius --enable-hyperthreading --publish --image debian-bookworm --submit --verbose"

nodes:
- vilnius
...
```

## Zenodo Token Setup

To publish experiment results on [Zenodo](https://zenodo.org/), you need a personal access token.
Generate one here: [Create Token](https://zenodo.org/account/settings/applications/tokens/new/).

You can provide the token in three different ways:

### 1. Environment Variable (recommended)

Add the token to your shell environment:

```bash
export ZENODO_ACCESS_TOKEN="your-token"
```

This ensures the token is available to both CLI and daemon processes.

---

### 2. Configuration File

Add the token to your experiment `config.yaml`:

```yaml
environment:
  secrets:
    ZENODO_ACCESS_TOKEN: "your-token"

```

---

### 3. Token File

Store the token in a local file (e.g. `~/zenodo-token`) and pass its path via CLI args:

```yaml
args: "vilnius --enable-hyperthreading --publish --image debian-bookworm --submit --zenodo-token-file /home/user/zenodo-token"
```

**Note:** If the daemon cannot read the file, prefer **1** or **2** instead.

---

## Using this Blueprint for Your Own Experiments

This stress-test blueprint can serve as a template for building and publishing your own experiments.
To adapt it:

1. **Experiment Metadata**
   - In `experiments.py`, change the experiment `title` and `description` to match your scenario.

2. **Experiment Logic**
   - In `loadgen/`, replace or modify `setup.sh` and `experiment.sh` with your own setup and measurement logic.

3. **Parameters**
   - In `variables/global.yml`, adapt parameters (e.g. CPU, memory, load intensity) to your needs.

4. **Execution**
   - Run the experiment with your updated configuration:

   ===#
   pos experiments execute config.yaml
   ===#

5. **Publication**
   - Use the `--publish` flag together with a Zenodo token (see above) to automatically upload and archive results.
   - Optionally, add `--submit` to forward results to the leaderboard.

---

✅ With these steps, you can easily replicate the workflow: **allocate node → run experiment → collect results → publish**.

### Parameters the user can control

- **Node**: Replace `vilnius` with the node you want to run on.
- **--enable-hyperthreading**: If set, loop over *threads* instead of *cores*.
- **--publish**: After execution, upload results to Zenodo (needs token).
- **--submit**: Ask the daemon to create a [leaderboard submission](https://kiliwarmuth.github.io/pos-energy-blueprint-experiment/).
- **--image**: OS image to boot on the node (`debian-trixie`, `debian-bookworm` - defaults to `debian-bookworm`).
- **--zenodo-token-file**: Path to your Zenodo Token for publishing your submission - alternative: provide the token in the `config.yaml`
- **--verbose / -v**: More detailed logging.

For all other possible arguments take a look inside `experiment.py`.

---

## Variables

Experiment parameters are in `variables/global.yml`. For example:

```yaml
runtime: 120    # runtime of stress workload in seconds
```

---

## Execution

Run the experiment on a pos management host:

```bash
pos experiments execute experiment/config.yaml
```

This will:

1. Free & allocate the chosen node.
2. Apply image + boot parameters.
3. Run `setup.sh` to install dependencies.
4. Run `loadgen.sh` in a loop (cores or threads).
5. Collect power/voltage/current traces.
6. Call the daemon’s `energy/visualize` to create plots + metrics.
7. Optionally upload to Zenodo (`--publish`).
8. Optionally submit to leaderboard repo (`--submit`).

---

## Outputs

After a run you will find in the results folder:

```text
result_folder/
├── energy/
│   ├── power-over-time.png
│   ├── current-over-time.png
│   ├── smoothed-voltage.png
│   ├── total-energy-per-node.png
│   └── metrics.json
└── ro-crate-metadata.json
```

If `--submit` was used, these files are packaged with a `manifest.json` and pushed to the leaderboard repository via the daemon.

---

## Notes

- `manifest.json` is built on the **daemon** side (`/energy/submit`) to ensure consistent metadata extraction from RO-Crate.
- Users only need to **clone &rarr; execute &rarr; upload**. The daemon handles submission logic.
- Zenodo publishing requires a valid token in `~/.secrets/zenodo_sandbox_token`.
