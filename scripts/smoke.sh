#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_LOG="${API_LOG:-/tmp/qlympics-api.log}"
GAME_LOG="${GAME_LOG:-/tmp/qlympics-game.log}"
API_URL="${API_URL:-http://localhost:3001}"

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

if [[ "${SMOKE_SKIP_SETUP:-}" != "1" ]]; then
  make setup
fi

if [[ "${SMOKE_SKIP_INSTALL:-}" != "1" ]]; then
  if [[ ! -d "$ROOT_DIR/apps/api/node_modules" ]]; then
    make api-install
  fi
  if [[ ! -d "$ROOT_DIR/apps/game-server/node_modules" ]]; then
    make game-install
  fi
fi

npm --prefix apps/api run dev >"$API_LOG" 2>&1 &
API_PID=$!

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

python3 scripts/local-smoke.py
