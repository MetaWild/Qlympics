BEGIN;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS runtime_identity text;

UPDATE agents
SET runtime_identity = substring(encode(gen_random_bytes(5), 'hex') FROM 1 FOR 10)
WHERE runtime_identity IS NULL OR runtime_identity = '';

ALTER TABLE agents
  ALTER COLUMN runtime_identity SET DEFAULT substring(encode(gen_random_bytes(5), 'hex') FROM 1 FOR 10),
  ALTER COLUMN runtime_identity SET NOT NULL;

ALTER TABLE agents
  DROP CONSTRAINT IF EXISTS agents_runtime_identity_format;

ALTER TABLE agents
  ADD CONSTRAINT agents_runtime_identity_format
  CHECK (runtime_identity ~ '^[A-Za-z0-9_-]{1,10}$');

COMMIT;
