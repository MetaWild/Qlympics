#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_LOG="${API_LOG:-/tmp/qlympics-api.log}"
GAME_LOG="${GAME_LOG:-/tmp/qlympics-game.log}"

API_PID=""
GAME_PID=""

cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" || true
  fi
  if [[ -n "$GAME_PID" ]] && kill -0 "$GAME_PID" 2>/dev/null; then
    kill "$GAME_PID" || true
  fi
}

trap cleanup EXIT

cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
  set +a
fi

E2E_API_PORT="${E2E_API_PORT:-3002}"
API_URL="${API_URL:-http://localhost:${E2E_API_PORT}}"
export API_URL

E2E_GRID_WIDTH="${E2E_GRID_WIDTH:-10}"
E2E_GRID_HEIGHT="${E2E_GRID_HEIGHT:-6}"
E2E_TICK_RATE="${E2E_TICK_RATE:-10}"
echo "E2E grid override: ${E2E_GRID_WIDTH}x${E2E_GRID_HEIGHT} tick=${E2E_TICK_RATE}"

# Ensure stale dev servers from prior aborted runs do not conflict with this execution.
pkill -f "npm --prefix apps/api run dev" >/dev/null 2>&1 || true
pkill -f "npm --prefix apps/game-server run dev" >/dev/null 2>&1 || true
if command -v lsof >/dev/null 2>&1; then
  lsof -ti "tcp:${E2E_API_PORT}" | xargs -r kill >/dev/null 2>&1 || true
fi

make setup
echo "Clearing redis state..."
docker compose exec -T redis redis-cli FLUSHALL >/dev/null

if [[ ! -d "$ROOT_DIR/apps/api/node_modules" ]]; then
  make api-install
fi
if [[ ! -d "$ROOT_DIR/apps/game-server/node_modules" ]]; then
  make game-install
fi

PORT="$E2E_API_PORT" GAME_GRID_WIDTH="$E2E_GRID_WIDTH" GAME_GRID_HEIGHT="$E2E_GRID_HEIGHT" GAME_TICK_RATE="$E2E_TICK_RATE" \
  npm --prefix apps/api run dev >"$API_LOG" 2>&1 &
API_PID=$!

GAME_GRID_WIDTH="$E2E_GRID_WIDTH" GAME_GRID_HEIGHT="$E2E_GRID_HEIGHT" GAME_TICK_RATE="$E2E_TICK_RATE" \
  npm --prefix apps/game-server run dev >"$GAME_LOG" 2>&1 &
GAME_PID=$!

python3 - "$API_URL" <<'PY'
import sys
import time
import urllib.request

url = f"{sys.argv[1].rstrip('/')}/health"
for _ in range(60):
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            if resp.status == 200:
                sys.exit(0)
    except Exception:
        time.sleep(0.5)

sys.exit(1)
PY

set +e
python3 -u scripts/e2e-chain.py
status=$?
set -e

if [[ $status -ne 0 ]]; then
  echo "E2E failed; last 200 lines of API log ($API_LOG):"
  tail -n 200 "$API_LOG" || true
  echo "E2E failed; last 200 lines of Game log ($GAME_LOG):"
  tail -n 200 "$GAME_LOG" || true
  exit "$status"
fi
