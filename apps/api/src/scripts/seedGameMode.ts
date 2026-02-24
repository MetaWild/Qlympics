import { Pool } from 'pg';
import { config } from '../config.js';

function requirePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  const value = raw && raw.trim() ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

async function main() {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const title = (process.env.GAME_TITLE ?? 'Coin Runner').trim() || 'Coin Runner';
  const maxPlayers = requirePositiveInt(process.env.GAME_MAX_PLAYERS, 5, 'GAME_MAX_PLAYERS');
  const durationSec = requirePositiveInt(process.env.GAME_DURATION_SEC, 60, 'GAME_DURATION_SEC');
  const coinsPerMatch = requirePositiveInt(process.env.GAME_COINS_PER_MATCH, 50, 'GAME_COINS_PER_MATCH');
  const rewardPoolQuai = (process.env.GAME_REWARD_POOL_QUAI ?? String(coinsPerMatch)).trim();
  const status = (process.env.GAME_STATUS ?? 'ACTIVE').trim() || 'ACTIVE';
  const configJsonRaw = (process.env.GAME_CONFIG_JSON ?? '{}').trim() || '{}';
  const modeConfig = JSON.parse(configJsonRaw) as Record<string, unknown>;

  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: Math.max(1, config.databasePoolMax),
    idleTimeoutMillis: config.databasePoolIdleTimeoutMs,
    connectionTimeoutMillis: config.databasePoolConnectionTimeoutMs
  });

  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string }>(
      `
      WITH existing AS (
        SELECT id
        FROM game_modes
        WHERE lower(title) = lower($1)
        ORDER BY id
        LIMIT 1
      ),
      updated AS (
        UPDATE game_modes
        SET
          max_players = $2::integer,
          duration_sec = $3::integer,
          coins_per_match = $4::integer,
          reward_pool_quai = $5::numeric(38,18),
          status = $6::game_mode_status,
          config = $7::jsonb
        WHERE id = (SELECT id FROM existing)
        RETURNING id
      ),
      inserted AS (
        INSERT INTO game_modes (title, max_players, duration_sec, coins_per_match, reward_pool_quai, status, config)
        SELECT
          $1,
          $2::integer,
          $3::integer,
          $4::integer,
          $5::numeric(38,18),
          $6::game_mode_status,
          $7::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id
      )
      SELECT id FROM updated
      UNION ALL
      SELECT id FROM inserted
      `,
      [title, maxPlayers, durationSec, coinsPerMatch, rewardPoolQuai, status, JSON.stringify(modeConfig)]
    );

    if (!result.rows[0]?.id) {
      throw new Error('Failed to seed game mode');
    }

    // eslint-disable-next-line no-console
    console.log(
      `Seeded game mode: id=${result.rows[0].id} title="${title}" max_players=${maxPlayers} duration_sec=${durationSec} coins_per_match=${coinsPerMatch} reward_pool_quai=${rewardPoolQuai}`
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Game mode seed failed:', error);
  process.exit(1);
});
