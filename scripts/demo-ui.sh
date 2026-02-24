#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_LOG="${API_LOG:-/tmp/qlympics-api.log}"
GAME_LOG="${GAME_LOG:-/tmp/qlympics-game.log}"
WEB_LOG="${WEB_LOG:-/tmp/qlympics-web.log}"

API_PID=""
GAME_PID=""
WEB_PID=""

cleanup() {
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" || true
  fi
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

AUTO_PAYOUTS_ENABLED="${AUTO_PAYOUTS_ENABLED:-0}"
if [[ "${E2E_SCENARIO:-}" == "scale" && "${E2E_SCALE_EXECUTE_PAYOUTS:-0}" == "1" ]]; then
  AUTO_PAYOUTS_ENABLED=1
fi
export AUTO_PAYOUTS_ENABLED

# Scale runs can trigger many RPC calls in a short period. Give Quai RPC a bit more breathing room.
if [[ "${E2E_SCENARIO:-}" == "scale" && "${E2E_SCALE_EXECUTE_PAYOUTS:-0}" == "1" ]]; then
  export PAYOUT_RPC_TIMEOUT_MS="${PAYOUT_RPC_TIMEOUT_MS:-60000}"
  export PAYOUT_ESTIMATE_ONCE="${PAYOUT_ESTIMATE_ONCE:-1}"
fi

# Scale demos can create many agents quickly; lower PoW difficulty by default so
# `E2E_SCALE_FILL_SECONDS` controls join pacing instead of CPU time.
SCALE_POW_DIFFICULTY=""
if [[ "${E2E_SCENARIO:-}" == "scale" ]]; then
  SCALE_POW_DIFFICULTY="${E2E_SCALE_POW_DIFFICULTY:-2}"
fi

if [[ -n "${E2E_GRID_WIDTH:-}" || -n "${E2E_GRID_HEIGHT:-}" || -n "${E2E_TICK_RATE:-}" ]]; then
  echo "Demo grid override: ${E2E_GRID_WIDTH:-default}x${E2E_GRID_HEIGHT:-default} tick=${E2E_TICK_RATE:-default}"
else
  echo "Demo grid: using defaults (100x56 tick=10)"
fi

echo "Starting UI demo stack..."
echo "API_URL=$API_URL"
echo "UI will be at http://localhost:5173"
echo "Logs: $API_LOG $GAME_LOG $WEB_LOG"

# Kill stale processes.
pkill -f "npm --prefix apps/api run dev" >/dev/null 2>&1 || true
pkill -f "npm --prefix apps/game-server run dev" >/dev/null 2>&1 || true
pkill -f "npm --prefix apps/web run dev" >/dev/null 2>&1 || true
if command -v lsof >/dev/null 2>&1; then
  lsof -ti "tcp:${E2E_API_PORT}" | xargs -r kill >/dev/null 2>&1 || true
  lsof -ti "tcp:5173" | xargs -r kill >/dev/null 2>&1 || true
  lsof -ti "tcp:3003" | xargs -r kill >/dev/null 2>&1 || true
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
if [[ ! -d "$ROOT_DIR/apps/web/node_modules" ]]; then
  make web-install
fi

# Start API and game server.
PORT="$E2E_API_PORT" \
  AUTO_PAYOUTS_ENABLED="$AUTO_PAYOUTS_ENABLED" \
  POW_DIFFICULTY="${SCALE_POW_DIFFICULTY:-${POW_DIFFICULTY:-}}" \
  GAME_GRID_WIDTH="${E2E_GRID_WIDTH:-}" \
  GAME_GRID_HEIGHT="${E2E_GRID_HEIGHT:-}" \
  GAME_TICK_RATE="${E2E_TICK_RATE:-}" \
  npm --prefix apps/api run dev >"$API_LOG" 2>&1 &
API_PID=$!

GAME_WS_PORT="${GAME_WS_PORT:-3003}" \
  npm --prefix apps/game-server run dev >"$GAME_LOG" 2>&1 &
GAME_PID=$!

# Start web dev server proxying to the E2E API and connecting to game-server WS.
VITE_PROXY_API_TARGET="$API_URL" \
VITE_GAME_WS_URL="ws://localhost:${GAME_WS_PORT:-3003}" \
  npm --prefix apps/web run dev >"$WEB_LOG" 2>&1 &
WEB_PID=$!

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

echo ""
echo "Open: http://localhost:5173"
if [[ "${E2E_SCENARIO:-}" == "scale" ]]; then
  if [[ "${E2E_SCALE_EXECUTE_PAYOUTS:-0}" == "1" ]]; then
    echo "Running UI scale scenario (10 lobbies x 10 agents; on-chain payouts enabled)..."
  else
    echo "Running UI scale scenario (10 lobbies x 10 agents; payouts dry-run)..."
  fi
else
  echo "Running UI demo match (longer lobby)..."
fi
echo ""

if [[ "${E2E_SCENARIO:-}" == "scale" ]]; then
  E2E_SCENARIO=scale \
  E2E_WEB_URL="${E2E_WEB_URL:-http://localhost:5173}" \
  E2E_SCALE_LOBBIES="${E2E_SCALE_LOBBIES:-10}" \
  E2E_SCALE_PLAYERS_PER_LOBBY="${E2E_SCALE_PLAYERS_PER_LOBBY:-10}" \
  E2E_SCALE_FILL_SECONDS="${E2E_SCALE_FILL_SECONDS:-300}" \
  E2E_SCALE_DURATION_SEC="${E2E_SCALE_DURATION_SEC:-60}" \
  E2E_SCALE_COINS_PER_MATCH="${E2E_SCALE_COINS_PER_MATCH:-10}" \
  E2E_SCALE_REWARD_POOL_QUAI="${E2E_SCALE_REWARD_POOL_QUAI:-10}" \
  E2E_SCALE_EXECUTE_PAYOUTS="${E2E_SCALE_EXECUTE_PAYOUTS:-0}" \
  E2E_SCALE_RUNNERS_PER_LOBBY="${E2E_SCALE_RUNNERS_PER_LOBBY:-${E2E_SCALE_PLAYERS_PER_LOBBY:-10}}" \
  E2E_SCALE_INPUT_EVERY_TICKS="${E2E_SCALE_INPUT_EVERY_TICKS:-1}" \
    python3 -u scripts/e2e-chain.py
else
  E2E_DEMO_UI=1 \
  E2E_PLAYER_COUNT=2 \
  E2E_JOIN_DELAY_SEC="${E2E_JOIN_DELAY_SEC:-12}" \
  E2E_GAME_DURATION_SEC="${E2E_GAME_DURATION_SEC:-60}" \
  E2E_GAME_COINS_PER_MATCH="${E2E_GAME_COINS_PER_MATCH:-60}" \
  E2E_DEMO_FINISH_GRACE_SEC="${E2E_DEMO_FINISH_GRACE_SEC:-90}" \
  E2E_WEB_URL="${E2E_WEB_URL:-http://localhost:5173}" \
    python3 -u scripts/e2e-chain.py
fi

echo ""
echo "UI demo complete."

HOLD_SEC="${E2E_DEMO_POSTMATCH_HOLD_SEC:-20}"
if [[ "$HOLD_SEC" -gt 0 ]]; then
  echo "Holding stack for ${HOLD_SEC}s so you can keep watching..."
  sleep "$HOLD_SEC"
fi
