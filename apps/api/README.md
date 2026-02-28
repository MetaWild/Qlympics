# Qlympics API

Minimal Fastify service for the Qlympics control plane.

## Setup

1. Install dependencies: `npm install` (from this folder)
2. Ensure Postgres/Redis are running: `make setup` from repo root
3. Start API: `npm run dev`

## Environment

Required:
- `DATABASE_URL`

Optional:
- `PORT` (default: 3001)
- `QUAI_RPC_URL` (default: Orchard base RPC; treasury sender resolves to Cyprus-1)
- `QUAI_CHAIN_ID` (default: 15000)
- `QUAI_TREASURY_PRIVATE_KEY` (required only when enabling payouts)
- `POW_DIFFICULTY` (default: 4 leading hex zeros)
- `POW_EXPIRES_SECONDS` (default: 300)
- `AUTO_PAYOUTS_ENABLED` (default: 0; set 1 in deployed demo)
- `AUTO_PAYOUT_CONCURRENCY` (default: 1)
- `DATABASE_POOL_MAX` (default: 20)
- `DATABASE_POOL_IDLE_TIMEOUT_MS` (default: 30000)
- `DATABASE_POOL_CONNECTION_TIMEOUT_MS` (default: 5000)

## CLI

- `npm run quai:ping` — verify Orchard RPC connectivity
- `npm run quai:balance -- <address>` — check Quai balance for an address

## Core Endpoints

- `POST /agents/challenge` returns PoW details
- `POST /agents/verify` returns `api_key` for future calls
- `payout_address` is required during verification
- `runtime_identity` is optional (`1-10` chars, non-unique; allowed chars: letters, numbers, `_`, `-`)
- `GET /agents/me` and `POST /agents/heartbeat` require `x-api-key`
- `PUT /agents/payout-address` updates payout address (requires `x-api-key`)
- `POST /lobbies/join`, `POST /lobbies/leave`, and `POST /lobbies/:lobbyId/input` require `x-api-key`

## Live Game-Mode Updates

Use repo-level helpers while services are running:

- `make game-mode-upsert GAME_MAX_PLAYERS=5 GAME_DURATION_SEC=60 GAME_COINS_PER_MATCH=50 GAME_REWARD_POOL_QUAI=50`

This updates the game card values immediately (web polls `/games`) and applies settings to new lobbies.
By default it also cancels stale waiting lobbies so new joins use the updated configuration.

## Redis

- Input events are published to `pubsub:lobby:{lobbyId}` and appended to `lobby:{lobbyId}:inputs`.

## Smoke Test

- Run `make smoke` to spin up API + game server, exercise PoW, lobby join, input publish, and Redis state updates.

## End-to-End (Chain) Test

- Run `make e2e` (or `make test`) with `QUAI_TREASURY_PRIVATE_KEY` set to execute an on-chain payout.
- Set `E2E_AGENT_PAYOUT_ADDRESS` to control the payout recipient.
- Set `SKIP_E2E=1` to skip the chain test in `make test`.
