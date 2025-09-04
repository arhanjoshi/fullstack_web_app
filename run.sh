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

cleanup() {
  echo "[run.sh] Caught exit; stopping background processes" >&2
  jobs -p | xargs -r kill || true
}
trap cleanup EXIT INT TERM

echo "[run.sh] Starting backend (@pluto/server) with Playwright (PRICE_SOURCE=tv)" >&2
PRICE_SOURCE=${PRICE_SOURCE:-tv} pnpm --filter @pluto/server start &

echo "[run.sh] Starting frontend (@pluto/web) on http://localhost:3000" >&2
pnpm --filter @pluto/web dev
