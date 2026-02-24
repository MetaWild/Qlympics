# Database

This project uses Postgres for durable records and Redis for real-time game state.

## Quick start

1. Create a local env file: `cp .env.example .env`
2. Start services and run migrations: `make setup`
3. Run the DB smoke check: `make test`

Note: `make setup` and `make test` require the `psql` client to be available on your PATH.

## Conventions

- Primary keys are UUIDs generated in Postgres.
- Quai amounts are stored as `numeric(38,18)` for human-readable display.
- Watch codes are 6-character uppercase alphanumeric strings.
- Agent identity is API-key based; `payout_address` is required.
- Timestamps use `timestamptz`.

## Environment variables

- `DATABASE_URL`: Postgres connection string used by migration and verify scripts.
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`: used by docker-compose defaults.
- `REDIS_URL`: Redis connection string.
