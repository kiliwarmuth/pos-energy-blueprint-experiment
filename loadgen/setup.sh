#!/bin/bash

# Exit immediately on error
set -e
# Log every command
set -x

# -----------------------------
# Variables
# -----------------------------
hostname=$(pos_get_variable hostname)

# -----------------------------
# Start
# -----------------------------
echo "[INFO] Starting setup on host: ${hostname}"

# -----------------------------
# System update & package install
# -----------------------------
echo "[INFO] Updating package lists"
apt-get update -y

echo "[INFO] Installing required packages: stress"
DEBIAN_FRONTEND=noninteractive apt-get install -y stress

# -----------------------------
# Finish
# -----------------------------
echo "[INFO] Setup completed successfully on ${hostname}"