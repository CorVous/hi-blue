#!/usr/bin/env bash
set -euo pipefail
IN="${PLAYTEST_IN:-/tmp/playtest-in}"
OUT="${PLAYTEST_OUT:-/tmp/playtest-out}"
if [ ! -p "$IN" ] || [ ! -p "$OUT" ]; then
  echo "FIFOs not ready (is the daemon running?)" >&2
  exit 1
fi
( cat "$OUT" ) &
READER_PID=$!
printf '%s\n' "$1" > "$IN"
wait $READER_PID
