#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/.env.prod}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.prod.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Create it from $DEPLOY_DIR/.env.prod.example" >&2
  exit 1
fi

echo "Building and starting production stack..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --pull

echo "Running database migrations..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm api node dist/scripts/migrate.js

echo "Seeding active game mode..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm api node dist/scripts/seedGameMode.js

echo "Starting services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans

echo "Waiting for API health..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "API healthy."
    break
  fi
  sleep 2
  if [[ "$i" -eq 30 ]]; then
    echo "API did not become healthy in time." >&2
    exit 1
  fi
done

echo "Deployment complete."
