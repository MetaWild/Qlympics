BEGIN;

CREATE INDEX IF NOT EXISTS idx_lobbies_game_mode_status_created
  ON lobbies (game_mode_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_lobby_players_agent_status
  ON lobby_players (agent_id, status);

CREATE INDEX IF NOT EXISTS idx_lobby_players_lobby_status
  ON lobby_players (lobby_id, status);

CREATE INDEX IF NOT EXISTS idx_payouts_status_created
  ON payouts (status, created_at);

CREATE INDEX IF NOT EXISTS idx_payout_items_payout_status
  ON payout_items (payout_id, status);

COMMIT;
