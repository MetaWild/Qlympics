BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_status') THEN
    CREATE TYPE agent_status AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'BANNED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'game_mode_status') THEN
    CREATE TYPE game_mode_status AS ENUM ('ACTIVE', 'INACTIVE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lobby_status') THEN
    CREATE TYPE lobby_status AS ENUM ('WAITING', 'ACTIVE', 'FINISHED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lobby_player_status') THEN
    CREATE TYPE lobby_player_status AS ENUM ('JOINED', 'LEFT', 'FINISHED', 'DISCONNECTED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payout_status') THEN
    CREATE TYPE payout_status AS ENUM ('PENDING', 'SENT', 'CONFIRMED', 'FAILED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL UNIQUE,
  name text,
  version text,
  status agent_status NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS agent_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_api_keys_agent_id ON agent_api_keys(agent_id);

CREATE TABLE IF NOT EXISTS agent_sessions (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_id ON agent_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_expires_at ON agent_sessions(expires_at);

CREATE TABLE IF NOT EXISTS agent_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL,
  nonce text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_challenges_wallet ON agent_challenges(wallet_address);
CREATE INDEX IF NOT EXISTS idx_agent_challenges_expires ON agent_challenges(expires_at);

CREATE TABLE IF NOT EXISTS game_modes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  preview_url text,
  max_players integer NOT NULL CHECK (max_players > 0),
  duration_sec integer NOT NULL CHECK (duration_sec > 0),
  coins_total integer NOT NULL CHECK (coins_total >= 0),
  reward_pool_quai numeric(38, 18) NOT NULL CHECK (reward_pool_quai >= 0),
  status game_mode_status NOT NULL DEFAULT 'ACTIVE',
  config jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS lobbies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_mode_id uuid NOT NULL REFERENCES game_modes(id) ON DELETE RESTRICT,
  watch_code char(6) NOT NULL,
  status lobby_status NOT NULL DEFAULT 'WAITING',
  max_players integer NOT NULL CHECK (max_players > 0),
  reward_pool_quai numeric(38, 18) NOT NULL CHECK (reward_pool_quai >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  seed bigint,
  finalization_hash text,
  CONSTRAINT lobbies_watch_code_format CHECK (watch_code ~ '^[A-Z0-9]{6}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lobbies_watch_code ON lobbies(watch_code);
CREATE INDEX IF NOT EXISTS idx_lobbies_status ON lobbies(status);

CREATE TABLE IF NOT EXISTS lobby_players (
  lobby_id uuid NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot >= 0),
  status lobby_player_status NOT NULL DEFAULT 'JOINED',
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  final_coins integer NOT NULL DEFAULT 0 CHECK (final_coins >= 0),
  final_reward_quai numeric(38, 18) NOT NULL DEFAULT 0 CHECK (final_reward_quai >= 0),
  PRIMARY KEY (lobby_id, agent_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lobby_players_lobby_slot ON lobby_players(lobby_id, slot);
CREATE INDEX IF NOT EXISTS idx_lobby_players_status ON lobby_players(status);

CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id uuid NOT NULL UNIQUE REFERENCES lobbies(id) ON DELETE CASCADE,
  status payout_status NOT NULL DEFAULT 'PENDING',
  tx_hash text,
  from_wallet text,
  total_quai numeric(38, 18) NOT NULL CHECK (total_quai >= 0),
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  error text
);

CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);

CREATE TABLE IF NOT EXISTS quai_price_ticks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_usd numeric(20, 10) NOT NULL CHECK (price_usd >= 0),
  source text NOT NULL,
  sampled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quai_price_ticks_sampled_at ON quai_price_ticks(sampled_at DESC);

COMMIT;
