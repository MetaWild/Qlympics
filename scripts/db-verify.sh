#!/usr/bin/env bash
set -euo pipefail

PSQL_BASE=()
USE_DOCKER=0

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
elif command -v docker >/dev/null 2>&1 && docker compose ps -q postgres >/dev/null 2>&1; then
  POSTGRES_USER=${POSTGRES_USER:-qlympics}
  POSTGRES_DB=${POSTGRES_DB:-qlympics}
  POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-qlympics}
  PSQL_BASE=(docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB")
  USE_DOCKER=1
else
  echo "psql not available and docker compose postgres service is not running" >&2
  exit 1
fi

if [[ "$USE_DOCKER" -eq 1 ]]; then
  "${PSQL_BASE[@]}" < scripts/db-verify.sql
else
  "${PSQL_BASE[@]}" -f scripts/db-verify.sql
fi
