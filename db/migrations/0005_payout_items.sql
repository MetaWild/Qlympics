BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payout_item_status') THEN
    CREATE TYPE payout_item_status AS ENUM ('PENDING', 'SENT', 'FAILED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  payout_address text NOT NULL,
  amount_quai numeric(38, 18) NOT NULL CHECK (amount_quai >= 0),
  status payout_item_status NOT NULL DEFAULT 'PENDING',
  tx_hash text,
  error text,
  attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payout_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_payout_items_status ON payout_items(status);
CREATE INDEX IF NOT EXISTS idx_payout_items_payout_id ON payout_items(payout_id);

COMMIT;
