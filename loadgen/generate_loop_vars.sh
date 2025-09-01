#!/bin/bash
# generate_loop_vars.sh
# Dynamically generate loop.yml based on node CPU cores

set -e

if [ $# -lt 2 ]; then
    echo "Usage: $0 <node> <output-file>"
    exit 1
fi

node=$1
outfile=$2

# Extract number of cores from pos JSON output
cores=$(pos nodes show "$node" --json | jq -r ".${node}.processor[0].cores")

if [ -z "$cores" ] || [ "$cores" = "null" ]; then
    echo "[ERROR] Could not determine number of cores for node $node"
    exit 1
fi

# Build the YAML list: [1,2,3,...,N]
core_list=$(seq -s, 1 "$cores")

# Write to output file
cat > "$outfile" <<EOF
# Auto-generated loop variables for $node
cores: [${core_list}]
EOF

echo "[INFO] Generated $outfile with cores: [${core_list}]"