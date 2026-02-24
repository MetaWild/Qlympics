BEGIN;

ALTER TABLE game_modes
  RENAME COLUMN coins_total TO coins_per_match;

COMMIT;
