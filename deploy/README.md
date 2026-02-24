# Managed Deployment (Domain + Managed DB/Redis)

This deployment profile runs:
- `web` (static frontend)
- `api`
- `game-server` (websocket + tick loop)
- `payout-worker` (dedicated payout subscriber)
- `caddy` (TLS + reverse proxy)

It expects **managed Postgres + managed Redis/Valkey** via environment variables.

## 1) Prepare config

```bash
cd /Users/joshuasalas/Projects/Qlympics
cp deploy/.env.prod.example deploy/.env.prod
```

Edit `deploy/.env.prod`:
- `QLYMPICS_DOMAIN` -> your production domain (example `play.example.com`)
- `QLYMPICS_EMAIL` -> email for TLS cert notices
- `VITE_GAME_WS_URL` -> `wss://<your-domain>`
- `DATABASE_URL` -> managed Postgres URL
- `REDIS_URL` -> managed Redis/Valkey URL (for cloud providers, usually `rediss://...`)
- `QUAI_TREASURY_PRIVATE_KEY` -> treasury private key

## 2) Domain + DNS

1. Buy/use a domain.
2. Create DNS `A` record:
   - host: the value in `QLYMPICS_DOMAIN` (or subdomain)
   - value: your server public IP
3. Open ports `80` and `443` on the server firewall.

## 3) Deploy

```bash
make deploy-prod
```

This builds images, starts services, runs DB migrations, and checks API health.

## 4) Update / rollout

```bash
make deploy-prod
```

## 5) Logs

```bash
make deploy-prod-logs
```

Or specific service:

```bash
./deploy/logs.sh api
./deploy/logs.sh game-server
./deploy/logs.sh payout-worker
```

## 6) Live game-mode updates (no redeploy)

```bash
make game-mode-upsert \
  GAME_MAX_PLAYERS=5 \
  GAME_DURATION_SEC=60 \
  GAME_COINS_PER_MATCH=50 \
  GAME_REWARD_POOL_QUAI=50
```
