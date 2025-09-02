#!/bin/bash

# The hosts are allocated, rebooted, and the experiment scripts are deployed
# The experiment prepares the loadgen and dut nodes for MoonGen experiments

set -e  # exit on error

# -------------------------------------------------------------------
# Parameters
# -------------------------------------------------------------------
loadgen=$1
experiment_name="stress-energy"
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

publish_results=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --publish)
            publish_results=true
            shift ;;
        *)
            break ;;
    esac
done

# -------------------------------------------------------------------
# Usage
# -------------------------------------------------------------------
display_usage() {
    echo "Usage: $0 <loadgen> [--publish]"
    echo "   - loadgen: Name of the load generator node"
    echo "   - --publish: Optional flag to publish results to Zenodo"
}

if [ -z "$loadgen" ]; then
    echo "[ERROR] No loadgen specified."
    display_usage
    exit 1
fi

# -------------------------------------------------------------------
# Setup Phase
# -------------------------------------------------------------------
echo
echo "============================================================"
echo "        pos Experiment Workflow – $experiment_name"
echo "============================================================"
echo

image=debian-trixie

echo "[SETUP] Freeing host: $loadgen"
pos allocations free "$loadgen"

echo "[SETUP] Allocating host: $loadgen"
pos allocations allocate "$loadgen"

echo "[SETUP] Generating loop variables based on $loadgen cores"
"$dir/loadgen/generate_loop_vars.sh" "$loadgen" "$dir/variables/loop.yml"

echo "[SETUP] Setting experiment variables"
pos allocations set_variables "$loadgen" --as-global "$dir/variables/global.yml"
pos allocations set_variables "$loadgen" --as-loop "$dir/variables/loop.yml"

echo "[SETUP] Applying image: $image"
pos nodes image "$loadgen" "$image"

echo "[SETUP] Applying boot parameters"
pos nodes bootparameter "$loadgen" "iommu=pt"

echo "[SETUP] Rebooting host: $loadgen"
pos nodes reset "$loadgen" --non-blocking

echo "[SETUP] Deploying setup scripts"
command_loadgen_id=$(pos commands launch --infile "$dir/loadgen/setup.sh" "$loadgen" --queued --name loadgen_setup_"$experiment_name")

echo "[WAIT] Waiting for setup to finish..."
pos commands await "$command_loadgen_id"

# -------------------------------------------------------------------
# Experiment Phase
# -------------------------------------------------------------------
echo
echo "------------------------------------------------------------"
echo "                Running Experiment: $experiment_name"
echo "------------------------------------------------------------"
echo

loadgen_id=$(pos commands launch --infile "$dir/loadgen/loadgen.sh" "$loadgen" --blocking --loop --name loadgen_exp_"$experiment_name")

RESULT_FOLDER=$(pos allocations show $loadgen | jq -r ".result_folder")
ALLOCATION_ID=$(pos allocations show $loadgen | jq -r ".id")

echo "[DONE] Experiment completed."
echo "       Result folder : $RESULT_FOLDER"
echo "       Allocation ID : $ALLOCATION_ID"

# -------------------------------------------------------------------
# Publication Phase
# -------------------------------------------------------------------
echo
echo "------------------------------------------------------------"
echo "                Result Publication"
echo "------------------------------------------------------------"
echo

if [ "$publish_results" = true ]; then
    echo "[PUBLISH] Uploading results to Zenodo..."
    pos results publish --result-folder "/srv/testbed/results/$RESULT_FOLDER" \
        --access-token-file ~/.secrets/zenodo_sandbox_token
    echo "[PUBLISH] Results published successfully."
else
    echo "[SKIP] Publication disabled (use --publish to enable)."
fi

echo
echo "============================================================"
echo "          Experiment workflow finished successfully"
echo "============================================================"