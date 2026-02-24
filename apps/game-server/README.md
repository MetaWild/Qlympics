# Qlympics Game Server

Minimal Redis-driven game server scaffold. Listens for lobby input events and updates lobby state.

## Setup

1. Install dependencies: `npm install` (from this folder)
2. Ensure Redis is running: `make setup` from repo root
3. Start server: `npm run dev`

Quick smoke: `make smoke` from repo root will start API + game server, then run the end-to-end flow.

## Environment

- `REDIS_URL` (default: redis://localhost:6379)
- `DATABASE_URL` (required)

## CLI

- `npm run inspect -- <lobbyId>` — print `lobby:{id}:state` and sequence value

## Redis Keys

- `lobbies:active` — active lobby ids
- `lobby:{id}:config` — grid/tick config
- `lobby:{id}:state` — live lobby state
