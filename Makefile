.PHONY: setup test test-scale lint fmt dev ci db-up db-down db-migrate db-verify db-reset game-mode-upsert api-install api-dev api-test api-build api-quai-ping game-install game-dev game-test game-build game-inspect smoke e2e
.PHONY: web-install web-dev web-build web-preview
.PHONY: demo-ui demo-ui-scale
.PHONY: deploy-prod deploy-prod-restart deploy-prod-logs

E2E_SCALE_EXECUTE_PAYOUTS ?= 0
E2E_SCALE_FILL_SECONDS ?= 300
E2E_SCALE_LOBBIES ?= 10
E2E_SCALE_PLAYERS_PER_LOBBY ?= 10
E2E_SCALE_DURATION_SEC ?= 60
E2E_SCALE_COINS_PER_MATCH ?= 10
E2E_SCALE_REWARD_POOL_QUAI ?= 10
E2E_SCALE_RUNNERS_PER_LOBBY ?= $(E2E_SCALE_PLAYERS_PER_LOBBY)
E2E_SCALE_INPUT_EVERY_TICKS ?= 1

POSTGRES_USER ?= qlympics
POSTGRES_PASSWORD ?= qlympics
POSTGRES_DB ?= qlympics

GAME_TITLE ?= Coin Runner
GAME_MAX_PLAYERS ?= 5
GAME_DURATION_SEC ?= 60
GAME_COINS_PER_MATCH ?= 50
GAME_REWARD_POOL_QUAI ?= 50
GAME_STATUS ?= ACTIVE
GAME_CONFIG_JSON ?= {}
RESET_WAITING_LOBBIES ?= 1

setup: db-up db-migrate

# Database helpers

DB_WAIT_CMD = docker compose exec -T postgres sh -c "until pg_isready -U $(POSTGRES_USER) -d $(POSTGRES_DB); do sleep 1; done"

DB_URL = postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@localhost:5432/$(POSTGRES_DB)

DATABASE_URL ?= $(DB_URL)


db-up:
	docker compose up -d postgres redis
	$(DB_WAIT_CMD)


db-down:
	docker compose down


db-migrate:
	DATABASE_URL="$(DATABASE_URL)" ./scripts/db-migrate.sh


db-verify:
	DATABASE_URL="$(DATABASE_URL)" ./scripts/db-verify.sh

db-reset:
	DATABASE_URL="$(DATABASE_URL)" REDIS_URL="$(REDIS_URL)" ./scripts/db-reset.sh

game-mode-upsert:
	DATABASE_URL="$(DATABASE_URL)" \
	REDIS_URL="$(REDIS_URL)" \
	GAME_TITLE="$(GAME_TITLE)" \
	GAME_MAX_PLAYERS="$(GAME_MAX_PLAYERS)" \
	GAME_DURATION_SEC="$(GAME_DURATION_SEC)" \
	GAME_COINS_PER_MATCH="$(GAME_COINS_PER_MATCH)" \
	GAME_REWARD_POOL_QUAI="$(GAME_REWARD_POOL_QUAI)" \
	GAME_STATUS="$(GAME_STATUS)" \
	GAME_CONFIG_JSON='$(GAME_CONFIG_JSON)' \
	RESET_WAITING_LOBBIES="$(RESET_WAITING_LOBBIES)" \
	./scripts/game-mode-upsert.sh

# API helpers

api-install:
	npm --prefix apps/api install

api-dev:
	npm --prefix apps/api run dev

api-build:
	npm --prefix apps/api run build

api-test:
	npm --prefix apps/api run test

api-quai-ping:
	npm --prefix apps/api run quai:ping

# Game server helpers

game-install:
	npm --prefix apps/game-server install

game-dev:
	npm --prefix apps/game-server run dev

game-build:
	npm --prefix apps/game-server run build

game-test:
	npm --prefix apps/game-server run test

game-inspect:
	npm --prefix apps/game-server run inspect -- $(LOBBY_ID)

web-install:
	npm --prefix apps/web install

web-dev:
	npm --prefix apps/web run dev

web-build:
	npm --prefix apps/web run build

web-preview:
	npm --prefix apps/web run preview

smoke:
	./scripts/smoke.sh

e2e:
	./scripts/e2e.sh

demo-ui:
	./scripts/demo-ui.sh

# UI scale demo: 10 lobbies x 10 agents, filled over 5 minutes. Payouts are dry-run by default.
demo-ui-scale:
	E2E_SCENARIO=scale \
	E2E_SCALE_LOBBIES=$(E2E_SCALE_LOBBIES) \
	E2E_SCALE_PLAYERS_PER_LOBBY=$(E2E_SCALE_PLAYERS_PER_LOBBY) \
	E2E_SCALE_FILL_SECONDS=$(E2E_SCALE_FILL_SECONDS) \
	E2E_SCALE_DURATION_SEC=$(E2E_SCALE_DURATION_SEC) \
	E2E_SCALE_COINS_PER_MATCH=$(E2E_SCALE_COINS_PER_MATCH) \
	E2E_SCALE_REWARD_POOL_QUAI=$(E2E_SCALE_REWARD_POOL_QUAI) \
	E2E_SCALE_EXECUTE_PAYOUTS=$(E2E_SCALE_EXECUTE_PAYOUTS) \
	E2E_SCALE_RUNNERS_PER_LOBBY=$(E2E_SCALE_RUNNERS_PER_LOBBY) \
	E2E_SCALE_INPUT_EVERY_TICKS=$(E2E_SCALE_INPUT_EVERY_TICKS) \
	./scripts/demo-ui.sh

# Project commands

dev: api-dev

test:
	./scripts/test.sh

# Large-scale demonstration: 10 lobbies x 10 agents, filled over 5 minutes.
# Defaults to DRY RUN for payouts (no on-chain tx). Enable with E2E_SCALE_EXECUTE_PAYOUTS=1.
test-scale:
	E2E_SCENARIO=scale \
	E2E_SCALE_LOBBIES=$(E2E_SCALE_LOBBIES) \
	E2E_SCALE_PLAYERS_PER_LOBBY=$(E2E_SCALE_PLAYERS_PER_LOBBY) \
	E2E_SCALE_FILL_SECONDS=$(E2E_SCALE_FILL_SECONDS) \
	E2E_SCALE_DURATION_SEC=$(E2E_SCALE_DURATION_SEC) \
	E2E_SCALE_COINS_PER_MATCH=$(E2E_SCALE_COINS_PER_MATCH) \
	E2E_SCALE_REWARD_POOL_QUAI=$(E2E_SCALE_REWARD_POOL_QUAI) \
	E2E_SCALE_EXECUTE_PAYOUTS=$(E2E_SCALE_EXECUTE_PAYOUTS) \
	./scripts/test.sh

lint:
	npm --prefix apps/api run lint
	npm --prefix apps/game-server run lint

fmt:
	@echo "No formatter config yet."

ci: lint fmt test

deploy-prod:
	./deploy/deploy.sh

deploy-prod-restart:
	./deploy/restart.sh

deploy-prod-logs:
	./deploy/logs.sh
