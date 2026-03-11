#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_LOG="${API_LOG:-/tmp/qlympics-api.log}"
GAME_LOG="${GAME_LOG:-/tmp/qlympics-game.log}"
E2E_MODE="${E2E_MODE:-local}" # local | external

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
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgres://${POSTGRES_USER:-qlympics}:${POSTGRES_PASSWORD:-qlympics}@localhost:5432/${POSTGRES_DB:-qlympics}}"
LOCAL_REDIS_URL="${LOCAL_REDIS_URL:-redis://localhost:6379}"

wait_for_health() {
  python3 - "$API_URL" <<'PY'
import sys
import time
import urllib.request

url = f"{sys.argv[1].rstrip('/')}/health"
for _ in range(60):
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            if resp.status == 200:
                sys.exit(0)
    except Exception:
        time.sleep(0.5)

sys.exit(1)
PY
}

if [[ "$E2E_MODE" == "external" ]]; then
  echo "E2E external mode: using existing API/game stack at ${API_URL}"
  export E2E_USE_EXISTING_STACK="${E2E_USE_EXISTING_STACK:-1}"
  export E2E_STATE_SOURCE="${E2E_STATE_SOURCE:-api}"
  export E2E_USE_DB_HELPERS="${E2E_USE_DB_HELPERS:-0}"
  export E2E_REQUIRE_PAYOUT="${E2E_REQUIRE_PAYOUT:-0}"

  wait_for_health

  set +e
  python3 -u scripts/e2e-chain.py
  status=$?
  set -e
  exit "$status"
fi

E2E_GRID_WIDTH="${E2E_GRID_WIDTH:-10}"
E2E_GRID_HEIGHT="${E2E_GRID_HEIGHT:-6}"
E2E_TICK_RATE="${E2E_TICK_RATE:-10}"
echo "E2E local mode grid override: ${E2E_GRID_WIDTH}x${E2E_GRID_HEIGHT} tick=${E2E_TICK_RATE}"

# Ensure stale dev servers from prior aborted runs do not conflict with this execution.
pkill -f "npm --prefix apps/api run dev" >/dev/null 2>&1 || true
pkill -f "npm --prefix apps/game-server run dev" >/dev/null 2>&1 || true
if command -v lsof >/dev/null 2>&1; then
  lsof -ti "tcp:${E2E_API_PORT}" | xargs -r kill >/dev/null 2>&1 || true
fi

DATABASE_URL="$LOCAL_DATABASE_URL" REDIS_URL="$LOCAL_REDIS_URL" make setup
echo "Clearing redis state..."
docker compose exec -T redis redis-cli FLUSHALL >/dev/null

if [[ ! -d "$ROOT_DIR/apps/api/node_modules" ]]; then
  make api-install
fi
if [[ ! -d "$ROOT_DIR/apps/game-server/node_modules" ]]; then
  make game-install
fi

PORT="$E2E_API_PORT" DATABASE_URL="$LOCAL_DATABASE_URL" REDIS_URL="$LOCAL_REDIS_URL" GAME_GRID_WIDTH="$E2E_GRID_WIDTH" GAME_GRID_HEIGHT="$E2E_GRID_HEIGHT" GAME_TICK_RATE="$E2E_TICK_RATE" \
  npm --prefix apps/api run dev >"$API_LOG" 2>&1 &
API_PID=$!

REDIS_URL="$LOCAL_REDIS_URL" GAME_GRID_WIDTH="$E2E_GRID_WIDTH" GAME_GRID_HEIGHT="$E2E_GRID_HEIGHT" GAME_TICK_RATE="$E2E_TICK_RATE" \
  npm --prefix apps/game-server run dev >"$GAME_LOG" 2>&1 &
GAME_PID=$!

wait_for_health

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
