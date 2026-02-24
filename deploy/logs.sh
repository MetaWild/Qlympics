#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/.env.prod}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.prod.yml"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs -f --tail=200 "${@:-}"
