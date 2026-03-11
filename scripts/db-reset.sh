#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PSQL_BASE=()
REDIS_BASE=()

sanitize_database_url_for_psql() {
  local raw="$1"
  if [[ -z "$raw" ]]; then
    printf '%s' "$raw"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    DATABASE_URL_RAW="$raw" python3 - <<'PY'
import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

raw = os.environ.get("DATABASE_URL_RAW", "")
parts = urlsplit(raw)
query = [(k, v) for (k, v) in parse_qsl(parts.query, keep_blank_values=True) if k.lower() != "uselibpqcompat"]
print(urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)), end="")
PY
    return
  fi
  printf '%s' "$raw" | sed -E \
    -e 's/([?&])uselibpqcompat=[^&]*&/\1/g' \
    -e 's/([?&])uselibpqcompat=[^&]*$//' \
    -e 's/\?&/\?/' \
    -e 's/\?$//'
}

if command -v psql >/dev/null 2>&1; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is not set" >&2
    exit 1
  fi
  DATABASE_URL_PSQL="$(sanitize_database_url_for_psql "$DATABASE_URL")"
  PSQL_BASE=(psql "$DATABASE_URL_PSQL" -v ON_ERROR_STOP=1)
  if command -v redis-cli >/dev/null 2>&1; then
    if [[ -n "${REDIS_URL:-}" ]]; then
      REDIS_BASE=(redis-cli -u "$REDIS_URL")
    else
      REDIS_BASE=(redis-cli)
    fi
  fi
elif command -v docker >/dev/null 2>&1 && docker compose ps -q postgres >/dev/null 2>&1; then
  POSTGRES_USER=${POSTGRES_USER:-qlympics}
  POSTGRES_DB=${POSTGRES_DB:-qlympics}
  POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-qlympics}
  PSQL_BASE=(docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB")
  REDIS_BASE=(docker compose exec -T redis redis-cli)
else
  echo "psql not available and docker compose postgres service is not running" >&2
  exit 1
fi

echo "Resetting Postgres gameplay tables..."
"${PSQL_BASE[@]}" <<'SQL'
TRUNCATE TABLE
  lobby_players,
  lobbies,
  payout_items,
  payouts,
  agent_api_keys,
  agent_pow_challenges,
  agents,
  game_modes,
  quai_price_ticks
RESTART IDENTITY CASCADE;
SQL

if [[ ${#REDIS_BASE[@]} -gt 0 ]]; then
  echo "Resetting Redis keys..."
  "${REDIS_BASE[@]}" FLUSHALL >/dev/null || true
else
  echo "Skipping Redis reset: redis-cli not found." >&2
fi

echo "Seeding default demo game mode (Coin Runner, 5 players, 60s, 50 coins, 50 Quai pool)..."
GAME_TITLE="${GAME_TITLE:-Coin Runner}" \
GAME_MAX_PLAYERS="${GAME_MAX_PLAYERS:-5}" \
GAME_DURATION_SEC="${GAME_DURATION_SEC:-60}" \
GAME_COINS_PER_MATCH="${GAME_COINS_PER_MATCH:-50}" \
GAME_REWARD_POOL_QUAI="${GAME_REWARD_POOL_QUAI:-50}" \
GAME_STATUS="${GAME_STATUS:-ACTIVE}" \
RESET_WAITING_LOBBIES=0 \
  "$ROOT_DIR/scripts/game-mode-upsert.sh"

echo "Database reset complete."
