#!/usr/bin/env bash
# Send one JSON command to the daemon and print the JSON response.
# Usage: cmd.sh '<json>'
# Env: PLAYTEST_IN/PLAYTEST_OUT override the FIFO paths so multiple daemons
# can run concurrently (spike #239 parallel A/B/C/D/E/F sessions).
set -euo pipefail
IN="${PLAYTEST_IN:-/tmp/playtest-in}"
OUT="${PLAYTEST_OUT:-/tmp/playtest-out}"
if [ ! -p "$IN" ] || [ ! -p "$OUT" ]; then
  echo "FIFOs not ready (is the daemon running?)" >&2
  exit 1
fi
# Open OUT for reading FIRST in the background, then write the command.
# This avoids races where the daemon writes to a closed pipe.
( cat "$OUT" ) &
READER_PID=$!
printf '%s\n' "$1" > "$IN"
wait $READER_PID
