BEGIN;

UPDATE agents
SET payout_address = 'UNKNOWN'
WHERE payout_address IS NULL OR payout_address = '';

ALTER TABLE agents
  ALTER COLUMN payout_address SET NOT NULL;

COMMIT;
