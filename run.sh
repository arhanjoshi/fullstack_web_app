#!/usr/bin/env bash
set -euo pipefail

# This script installs dependencies, generates code (if tools are available),
# installs Playwright browsers, then starts backend and frontend.

echo "[run.sh] Installing dependencies (pnpm install --recursive)" >&2
pnpm install --recursive

echo "[run.sh] Attempting buf generate (if buf is available)" >&2
if command -v buf >/dev/null 2>&1; then
  pnpm --filter @pluto/proto exec buf generate || true
else
  echo "[run.sh] buf not found; using pre-generated TS stubs" >&2
fi

echo "[run.sh] Installing Playwright chromium browser (server)" >&2
# Use --with-deps for Debian-based systems to fetch required libs
pnpm --filter @pluto/server exec playwright install --with-deps chromium || pnpm --filter @pluto/server exec playwright install chromium || true

# Free ports if currently in use to avoid EADDRINUSE
free_port() {
  local PORT="$1"
  if command -v lsof >/dev/null 2>&1; then
    local PIDS
    PIDS=$(lsof -ti tcp:"$PORT" || true)
    if [ -n "$PIDS" ]; then
      echo "[run.sh] Port $PORT in use by PIDs: $PIDS — killing" >&2
      kill -9 $PIDS || true
      sleep 0.3
    fi
  elif command -v fuser >/dev/null 2>&1; then
    echo "[run.sh] Freeing port $PORT via fuser" >&2
    fuser -k "$PORT"/tcp || true
    sleep 0.3
  else
    echo "[run.sh] Could not auto-free port $PORT (no lsof/fuser). If you hit EADDRINUSE, stop the other process." >&2
  fi
}

echo "[run.sh] Ensuring ports are free (8080 backend, 3000 web)" >&2
free_port 8080
free_port 3000

cleanup() {
  echo "[run.sh] Caught exit; stopping background processes" >&2
  jobs -p | xargs -r kill || true
}
trap cleanup EXIT INT TERM

echo "[run.sh] Starting backend (@pluto/server) with Playwright (PRICE_SOURCE=${PRICE_SOURCE:-tv})" >&2
PRICE_SOURCE=${PRICE_SOURCE:-tv} pnpm --filter @pluto/server start &

echo "[run.sh] Starting frontend (@pluto/web) on http://localhost:3000" >&2
pnpm --filter @pluto/web dev
