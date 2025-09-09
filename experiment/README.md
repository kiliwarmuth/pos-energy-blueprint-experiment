# pos Energy Stress Test — `experiment/`

This folder contains a self-contained experiment that (1) allocates a pos node, (2) runs a CPU stress/energy measurement loop, (3) renders energy plots, and (optionally) (4) submits the run to the leaderboard repository via the pos daemon.

---

## Folder layout

```text
 experiment
├──  loadgen
│  ├── loadgen.sh                 # executes the actual experiment workload
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
  args: "vilnius --enable-hyperthreading --publish --image debian-bookworm --submit -v"

nodes:
- vilnius

...
```

### Parameters the user can control

- **Node**: Replace `vilnius` with the node you want to run on.
- **--enable-hyperthreading**: If set, loop over *threads* instead of *cores*.
- **--publish**: After execution, upload results to Zenodo (needs token).
- **--submit**: Ask the daemon to create a [leaderboard submission](https://kiliwarmuth.github.io/pos-energy-blueprint-experiment/).
- **--image**: OS image to boot on the node (`debian-trixie`, `debian-bookworm` - defaults to `debian-bookworm`).
- **--zenodo-token-file**: Path to your Zenodo Token for publishing your submission
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
