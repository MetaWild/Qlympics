# Launch Checklist (Testnet Demo)

For managed deployment (recommended), follow:
- `deploy/README.md`

## 1) Environment

1. Copy env and fill required keys:
   - `cp .env.example .env`
2. Set these required values in `.env`:
   - `QUAI_TREASURY_PRIVATE_KEY=<treasury_private_key>`
   - `AUTO_PAYOUTS_ENABLED=1`
   - `QUAI_RPC_URL=https://orchard.rpc.quai.network`
   - `QUAI_CHAIN_ID=15000`
3. Optional scale knobs:
   - `AUTO_PAYOUT_CONCURRENCY=2`
   - `DATABASE_POOL_MAX=20`

## 2) Fresh Reset + Seed

Run:

```bash
make setup
make db-reset
```

This resets Postgres + Redis gameplay data and seeds demo mode:
- `Coin Runner`
- `max_players=5`
- `duration_sec=60`
- `coins_per_match=50`
- `reward_pool_quai=50`

## 3) Start Services

Use three processes:

```bash
npm --prefix apps/api run dev
npm --prefix apps/game-server run dev
npm --prefix apps/web run dev
```

Production equivalent:
- API: `npm --prefix apps/api run build && npm --prefix apps/api run start`
- Game server: `npm --prefix apps/game-server run build && npm --prefix apps/game-server run start`
- Web: `npm --prefix apps/web run build` then serve `apps/web/dist` behind your reverse proxy.

## 4) Configure Live (No Restart)

Update game settings while running:

```bash
make game-mode-upsert \
  GAME_MAX_PLAYERS=5 \
  GAME_DURATION_SEC=60 \
  GAME_COINS_PER_MATCH=50 \
  GAME_REWARD_POOL_QUAI=50
```

Notes:
- Website updates automatically from `/games`.
- Existing `WAITING` lobbies are cancelled by default so new joins use updated values.

## 5) Validate Before Public Demo

1. Health:
   - `curl http://localhost:3001/health`
2. RPC:
   - `make api-quai-ping`
3. Full flow:
   - `make smoke`
4. Optional full payout e2e:
   - `make test`

## 6) Networking / Deployment Requirements

1. Reverse proxy routes:
   - `/health`, `/stats`, `/games`, `/lobbies`, `/agents`, `/payouts` -> API service
   - `/ws/lobbies/*` -> game-server websocket service
   - `/` -> static web app
2. Keep API + game-server on same Redis + Postgres.
3. Persist Postgres and Redis volumes.
4. Restrict infra access to `.env` and treasury key.

---

## Managed Deploy (Domain + Managed DB/Redis)

1. Copy:
   - `cp deploy/.env.prod.example deploy/.env.prod`
2. Edit `deploy/.env.prod`:
   - set `QLYMPICS_DOMAIN` to your domain
   - set `VITE_GAME_WS_URL` to `wss://<same-domain>`
   - set managed `DATABASE_URL` + `REDIS_URL` (`rediss://...` for most managed Redis/Valkey)
   - set `QUAI_TREASURY_PRIVATE_KEY`
3. Point DNS `A` record for `QLYMPICS_DOMAIN` to your server IP.
4. Open ports `80/443`.
5. Deploy:
   - `make deploy-prod`
