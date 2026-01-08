#!/bin/bash

# exit on error
set -e
# log every command

# -----------------------------
# Local configuration
# -----------------------------
test_name="stress-test"
sleep_duration_before_test=2

# -----------------------------
# Loop / Global variables
# -----------------------------
cores=$(pos_get_variable cores --from-loop)
runtime=$(pos_get_variable runtime --from-global)

# -----------------------------
# logging helpers
# -----------------------------
info()  { printf "%s [INFO] %s\n"  "$(date '+%F %T')" "$*"; }
note()  { printf "%s [NOTE] %s\n"  "$(date '+%F %T')" "$*"; }
warn()  { printf "%s [WARNING] %s\n"  "$(date '+%F %T')" "$*"; }

safe_energy_start() {
    if ! pos_energy_start --loop --filename "measurement"; then
        warn "Energy measurement start failed — continuing without energy data"
    fi
}

safe_energy_stop() {
    if ! pos_energy_stop; then
        warn "Energy measurement stop failed"
    fi
}

# -----------------------------
# Start
# -----------------------------
info "Starting LoadGen script for test: ${test_name}"
note "Parameters: cores=${cores}, runtime=${runtime}s"

info "Starting test ${test_name}"

# -----------------------------
# Energy measurement: start
# -----------------------------
info "Starting energy measurement (loop mode, filename: measurement)"
safe_energy_start

# -----------------------------
# Launch load generator
# -----------------------------
info "Launching stress (pos_run) in loop scope: stress -c ${cores} -t ${runtime}"
pos_run --loop "$test_name" -- bash -c "exec stress -c $cores -t $runtime"

# -----------------------------
# Measurement period
# -----------------------------
info "Sleeping for measurement duration: ${runtime}s"
sleep "$runtime"

# -----------------------------
# Wrap up
# -----------------------------
info "Stopping test ${test_name}"

info "Stopping energy measurement"
safe_energy_stop

info "All done LoadGen ${test_name}"