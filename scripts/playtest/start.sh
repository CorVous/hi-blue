#!/usr/bin/env bash

set -uo pipefail

WRANGLER_LOG="${WRANGLER_LOG:-/tmp/wrangler.log}"
DAEMON_LOG="${PLAYTEST_LOG:-/tmp/playtest-daemon.log}"
WRANGLER_PID_FILE="/tmp/playtest-wrangler.pid"
DAEMON_PID_FILE="/tmp/playtest-daemon.pid"
PORT="${PORT:-8787}"
PLAYTEST_ORIGIN="http://127.0.0.1:$PORT"

fail() {
  echo "FAILED: $*" >&2
  exit 1
}

RESTORE_FROM="${PLAYTEST_RESTORE:-}"
if [ "${1:-}" = "--resume" ]; then
  RESTORE_FROM="${2:-}"
  [ -n "$RESTORE_FROM" ] || fail "--resume needs a save file path (see /tmp/playtest-saves/)"
fi
if [ -n "$RESTORE_FROM" ] && [ ! -f "$RESTORE_FROM" ]; then
  fail "save file not found: $RESTORE_FROM"
fi

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  fail "OPENROUTER_API_KEY is not set in the environment"
fi

pid_file_runs() {
  [ -f "$1" ] && ps -p "$(cat "$1")" -o args= 2>/dev/null | grep -q "$2"
}

if pid_file_runs "$WRANGLER_PID_FILE" "wrangler"; then
  fail "wrangler dev appears to be already running (pid $(cat "$WRANGLER_PID_FILE")). Stop it first: pkill -f 'wrangler dev'"
fi
if pid_file_runs "$DAEMON_PID_FILE" "playtest/daemon.mjs"; then
  fail "playtest daemon appears to be already running (pid $(cat "$DAEMON_PID_FILE")). Stop it first: cmd.sh '{\"op\":\"shutdown\"}'"
fi

echo "[start.sh] building SPA..." >&2
if ! WORKER_BASE_URL="$PLAYTEST_ORIGIN" pnpm build >/dev/null 2>&1; then
  fail "pnpm build failed; run 'pnpm build' manually to diagnose"
fi

echo "[start.sh] launching wrangler dev on port $PORT..." >&2
: > "$WRANGLER_LOG"
WORKER_BASE_URL="$PLAYTEST_ORIGIN" nohup pnpm exec wrangler dev --local --ip 127.0.0.1 --port "$PORT" \
  --var "OPENROUTER_API_KEY:$OPENROUTER_API_KEY" \
  --var "ALLOWED_ORIGINS:$PLAYTEST_ORIGIN" \
  >>"$WRANGLER_LOG" 2>&1 &
echo $! > "$WRANGLER_PID_FILE"

echo "[start.sh] waiting for worker to come up..." >&2
for _ in $(seq 1 120); do
  if curl -sS -o /dev/null -w "%{http_code}" "$PLAYTEST_ORIGIN/" 2>/dev/null | grep -qE '^(2|3|4)'; then
    break
  fi
  sleep 0.5
done
if ! curl -sS -o /dev/null -w "%{http_code}" "$PLAYTEST_ORIGIN/" 2>/dev/null | grep -qE '^(2|3|4)'; then
  cat "$WRANGLER_LOG" >&2 || true
  fail "wrangler dev did not come up on port $PORT within 60s"
fi

echo "[start.sh] launching playtest daemon..." >&2
: > "$DAEMON_LOG"
if [ -n "$RESTORE_FROM" ]; then
  echo "[start.sh] resuming saved game from $RESTORE_FROM" >&2
fi
PLAYTEST_ORIGIN="$PLAYTEST_ORIGIN" PLAYTEST_RESTORE="$RESTORE_FROM" nohup node scripts/playtest/daemon.mjs >>"$DAEMON_LOG" 2>&1 &
echo $! > "$DAEMON_PID_FILE"

echo "[start.sh] waiting for game route to reach stable state (this can take up to 6 minutes)..." >&2
for _ in $(seq 1 720); do
  if grep -q "game route loaded — daemon ready" "$DAEMON_LOG" 2>/dev/null; then
    echo "READY"
    exit 0
  fi
  if ! kill -0 "$(cat "$DAEMON_PID_FILE")" 2>/dev/null; then
    cat "$DAEMON_LOG" >&2 || true
    fail "playtest daemon exited before becoming ready"
  fi
  sleep 0.5
done

cat "$DAEMON_LOG" >&2 || true
fail "playtest daemon did not become ready within 6 minutes"
