#!/usr/bin/env bash

set -uo pipefail

WRANGLER_LOG="${WRANGLER_LOG:-/tmp/wrangler.log}"
DAEMON_LOG="${PLAYTEST_LOG:-/tmp/playtest-daemon.log}"
WRANGLER_PID_FILE="/tmp/playtest-wrangler.pid"
DAEMON_PID_FILE="/tmp/playtest-daemon.pid"
PORT="${PORT:-8787}"

fail() {
  echo "FAILED: $*" >&2
  exit 1
}

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  fail "OPENROUTER_API_KEY is not set in the environment"
fi

if [ -f "$WRANGLER_PID_FILE" ] && kill -0 "$(cat "$WRANGLER_PID_FILE")" 2>/dev/null; then
  fail "wrangler dev appears to be already running (pid $(cat "$WRANGLER_PID_FILE")). Stop it first: pkill -f 'wrangler dev'"
fi
if [ -f "$DAEMON_PID_FILE" ] && kill -0 "$(cat "$DAEMON_PID_FILE")" 2>/dev/null; then
  fail "playtest daemon appears to be already running (pid $(cat "$DAEMON_PID_FILE")). Stop it first: cmd.sh '{\"op\":\"shutdown\"}'"
fi

echo "[start.sh] building SPA..." >&2
if ! pnpm build >/dev/null 2>&1; then
  fail "pnpm build failed; run 'pnpm build' manually to diagnose"
fi

echo "[start.sh] launching wrangler dev on port $PORT..." >&2
: > "$WRANGLER_LOG"
nohup pnpm exec wrangler dev --local --port "$PORT" \
  --var "OPENROUTER_API_KEY:$OPENROUTER_API_KEY" \
  --var "ALLOWED_ORIGINS:http://localhost:$PORT" \
  >>"$WRANGLER_LOG" 2>&1 &
echo $! > "$WRANGLER_PID_FILE"

echo "[start.sh] waiting for worker to come up..." >&2
for _ in $(seq 1 120); do
  if curl -sS -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" 2>/dev/null | grep -qE '^(2|3|4)'; then
    break
  fi
  sleep 0.5
done
if ! curl -sS -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" 2>/dev/null | grep -qE '^(2|3|4)'; then
  cat "$WRANGLER_LOG" >&2 || true
  fail "wrangler dev did not come up on port $PORT within 60s"
fi

echo "[start.sh] launching playtest daemon..." >&2
: > "$DAEMON_LOG"
nohup node scripts/playtest/daemon.mjs >>"$DAEMON_LOG" 2>&1 &
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
