#!/usr/bin/env bash
set -euo pipefail

GAME_TITLE="${GAME_TITLE:-Coin Runner}"
GAME_PREVIEW_URL="${GAME_PREVIEW_URL:-}"
GAME_MAX_PLAYERS="${GAME_MAX_PLAYERS:-5}"
GAME_DURATION_SEC="${GAME_DURATION_SEC:-60}"
GAME_COINS_PER_MATCH="${GAME_COINS_PER_MATCH:-50}"
GAME_REWARD_POOL_QUAI="${GAME_REWARD_POOL_QUAI:-$GAME_COINS_PER_MATCH}"
GAME_STATUS="${GAME_STATUS:-ACTIVE}"
GAME_CONFIG_JSON="${GAME_CONFIG_JSON-}"
if [[ -z "$GAME_CONFIG_JSON" ]]; then
  GAME_CONFIG_JSON='{}'
fi
RESET_WAITING_LOBBIES="${RESET_WAITING_LOBBIES:-1}"

if ! [[ "$GAME_MAX_PLAYERS" =~ ^[0-9]+$ ]] || [[ "$GAME_MAX_PLAYERS" -le 0 ]]; then
  echo "GAME_MAX_PLAYERS must be a positive integer" >&2
  exit 1
fi
if ! [[ "$GAME_DURATION_SEC" =~ ^[0-9]+$ ]] || [[ "$GAME_DURATION_SEC" -le 0 ]]; then
  echo "GAME_DURATION_SEC must be a positive integer" >&2
  exit 1
fi
if ! [[ "$GAME_COINS_PER_MATCH" =~ ^[0-9]+$ ]] || [[ "$GAME_COINS_PER_MATCH" -lt 0 ]]; then
  echo "GAME_COINS_PER_MATCH must be a non-negative integer" >&2
  exit 1
fi

PSQL_BASE=()
REDIS_BASE=()
USE_DOCKER=0

if command -v psql >/dev/null 2>&1; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is not set" >&2
    exit 1
  fi
  PSQL_BASE=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1)
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
  USE_DOCKER=1
else
  echo "psql not available and docker compose postgres service is not running" >&2
  exit 1
fi

mode_id="$(
  sql_escape() {
    printf "%s" "$1" | sed "s/'/''/g"
  }
  game_title_esc="$(sql_escape "$GAME_TITLE")"
  game_preview_url_esc="$(sql_escape "$GAME_PREVIEW_URL")"
  game_reward_pool_quai_esc="$(sql_escape "$GAME_REWARD_POOL_QUAI")"
  game_status_esc="$(sql_escape "$GAME_STATUS")"
  game_config_json_esc="$(sql_escape "$GAME_CONFIG_JSON")"

  "${PSQL_BASE[@]}" -tA -c "
      WITH existing AS (
        SELECT id
        FROM game_modes
        WHERE lower(title) = lower('${game_title_esc}')
        ORDER BY id
        LIMIT 1
      ),
      updated AS (
        UPDATE game_modes
        SET
          preview_url = NULLIF('${game_preview_url_esc}', ''),
          max_players = ${GAME_MAX_PLAYERS}::integer,
          duration_sec = ${GAME_DURATION_SEC}::integer,
          coins_per_match = ${GAME_COINS_PER_MATCH}::integer,
          reward_pool_quai = ${game_reward_pool_quai_esc}::numeric(38,18),
          status = '${game_status_esc}'::game_mode_status,
          config = '${game_config_json_esc}'::jsonb
        WHERE id = (SELECT id FROM existing)
        RETURNING id
      ),
      inserted AS (
        INSERT INTO game_modes (title, preview_url, max_players, duration_sec, coins_per_match, reward_pool_quai, status, config)
        SELECT
          '${game_title_esc}',
          NULLIF('${game_preview_url_esc}', ''),
          ${GAME_MAX_PLAYERS}::integer,
          ${GAME_DURATION_SEC}::integer,
          ${GAME_COINS_PER_MATCH}::integer,
          ${game_reward_pool_quai_esc}::numeric(38,18),
          '${game_status_esc}'::game_mode_status,
          '${game_config_json_esc}'::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id
      )
      SELECT id FROM updated
      UNION ALL
      SELECT id FROM inserted;
    " | tr -d '[:space:]'
)"

if [[ -z "$mode_id" ]]; then
  echo "Failed to upsert game mode" >&2
  exit 1
fi

cancelled_count=0
if [[ "$RESET_WAITING_LOBBIES" == "1" ]]; then
  if [[ ${#REDIS_BASE[@]} -eq 0 ]]; then
    echo "Warning: redis-cli not found, waiting lobby redis cleanup is skipped." >&2
  fi
  cancelled_ids="$(
    "${PSQL_BASE[@]}" -tA -c "
      UPDATE lobbies
      SET status = 'CANCELLED', finished_at = now()
      WHERE game_mode_id = '${mode_id}'::uuid
        AND status = 'WAITING'
      RETURNING id;
    "
  )"
  if [[ -n "$cancelled_ids" ]]; then
    while IFS= read -r lobby_id; do
      [[ -z "$lobby_id" ]] && continue
      cancelled_count=$((cancelled_count + 1))
      if [[ ${#REDIS_BASE[@]} -gt 0 ]]; then
        "${REDIS_BASE[@]}" DEL \
          "lobby:${lobby_id}:state" \
          "lobby:${lobby_id}:config" \
          "lobby:${lobby_id}:inputs" \
          "lobby:${lobby_id}:players" \
          "lobby:${lobby_id}:seq" \
          "lobby:${lobby_id}:finalized" >/dev/null 2>&1 || true
        "${REDIS_BASE[@]}" SREM "lobbies:active" "$lobby_id" >/dev/null 2>&1 || true
      fi
    done <<<"$cancelled_ids"
  fi
fi

echo "Upserted game mode:"
echo "  id=$mode_id"
echo "  title=$GAME_TITLE"
echo "  max_players=$GAME_MAX_PLAYERS duration_sec=$GAME_DURATION_SEC coins_per_match=$GAME_COINS_PER_MATCH reward_pool_quai=$GAME_REWARD_POOL_QUAI status=$GAME_STATUS"
if [[ "$RESET_WAITING_LOBBIES" == "1" ]]; then
  echo "  cancelled_waiting_lobbies=$cancelled_count"
fi

if [[ "$USE_DOCKER" -eq 1 ]]; then
  echo "  backend=postgres+redis via docker compose"
fi
