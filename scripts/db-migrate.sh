#!/usr/bin/env bash
set -euo pipefail

PSQL_BASE=()
PSQL_QUERY=()
USE_DOCKER=0

if command -v psql >/dev/null 2>&1; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is not set" >&2
    exit 1
  fi
  PSQL_BASE=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1)
  PSQL_QUERY=(psql "$DATABASE_URL" -tA -c)
elif command -v docker >/dev/null 2>&1 && docker compose ps -q postgres >/dev/null 2>&1; then
  POSTGRES_USER=${POSTGRES_USER:-qlympics}
  POSTGRES_DB=${POSTGRES_DB:-qlympics}
  POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-qlympics}
  PSQL_BASE=(docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB")
  PSQL_QUERY=(docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c)
  USE_DOCKER=1
else
  echo "psql not available and docker compose postgres service is not running" >&2
  exit 1
fi

if [[ ! -d "db/migrations" ]]; then
  echo "db/migrations not found" >&2
  exit 1
fi

"${PSQL_BASE[@]}" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

shopt -s nullglob
migration_files=(db/migrations/*.sql)
shopt -u nullglob

if [[ ${#migration_files[@]} -eq 0 ]]; then
  echo "No migrations found in db/migrations" >&2
  exit 1
fi

for file in "${migration_files[@]}"; do
  version=$(basename "$file")
  already_applied=$("${PSQL_QUERY[@]}" "SELECT 1 FROM schema_migrations WHERE version = '$version'" | tr -d '[:space:]')
  if [[ "$already_applied" != "1" ]]; then
    echo "Applying $version"
    if [[ "$USE_DOCKER" -eq 1 ]]; then
      "${PSQL_BASE[@]}" < "$file"
    else
      "${PSQL_BASE[@]}" -f "$file"
    fi
    "${PSQL_BASE[@]}" -c "INSERT INTO schema_migrations (version) VALUES ('$version')"
  else
    echo "Skipping $version (already applied)"
  fi
done
