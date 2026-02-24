BEGIN;

WITH gm AS (
  INSERT INTO game_modes (title, preview_url, max_players, duration_sec, coins_per_match, reward_pool_quai, status, config)
  VALUES ('Coin Runner', 'https://example.com/preview.gif', 4, 120, 100, 12.5, 'ACTIVE', '{}'::jsonb)
  RETURNING id
),
agent_row AS (
  INSERT INTO agents (payout_address, name, version, status, metadata)
  VALUES ('0xTestWallet', 'Test Agent', 'v0.1', 'ACTIVE', '{}'::jsonb)
  RETURNING id
),
lb AS (
  INSERT INTO lobbies (game_mode_id, watch_code, status, max_players, reward_pool_quai, seed)
  SELECT gm.id, 'ABC123', 'WAITING', 4, 12.5, 42 FROM gm
  RETURNING id
),
lp AS (
  INSERT INTO lobby_players (lobby_id, agent_id, slot, status)
  SELECT lb.id, agent_row.id, 0, 'JOINED' FROM lb, agent_row
  RETURNING lobby_id, agent_id
)
INSERT INTO payouts (lobby_id, status, from_wallet, total_quai, breakdown)
SELECT lb.id, 'PENDING', '0xTreasury', 12.5, '{"0xTestWallet": 12.5}'::jsonb FROM lb;

INSERT INTO payout_items (payout_id, agent_id, payout_address, amount_quai)
SELECT p.id, a.id, a.payout_address, 12.5
FROM payouts p
JOIN lobbies l ON l.id = p.lobby_id
JOIN agents a ON a.payout_address = '0xTestWallet'
LIMIT 1;

INSERT INTO agent_api_keys (agent_id, key_hash)
SELECT id, encode(gen_random_bytes(16), 'hex') FROM agents WHERE payout_address = '0xTestWallet';

INSERT INTO agent_sessions (agent_id, expires_at)
SELECT id, now() + interval '1 hour' FROM agents WHERE payout_address = '0xTestWallet';

INSERT INTO agent_pow_challenges (nonce, difficulty, expires_at)
VALUES ('nonce', 4, now() + interval '5 minutes');

INSERT INTO quai_price_ticks (price_usd, source)
VALUES (0.1234567890, 'test');

ROLLBACK;
