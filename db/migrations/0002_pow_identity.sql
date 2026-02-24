BEGIN;

ALTER TABLE agents
  RENAME COLUMN wallet_address TO payout_address;

ALTER TABLE agents
  ALTER COLUMN payout_address DROP NOT NULL;

ALTER TABLE agents
  DROP CONSTRAINT IF EXISTS agents_wallet_address_key;

DROP TABLE IF EXISTS agent_challenges;

CREATE TABLE IF NOT EXISTS agent_pow_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce text NOT NULL,
  difficulty integer NOT NULL CHECK (difficulty > 0),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_pow_challenges_expires ON agent_pow_challenges(expires_at);

COMMIT;
