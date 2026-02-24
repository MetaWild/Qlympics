import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { getPool } from '../src/db.js';
import type { Pool } from 'pg';

type IdRow = { id: string };

let pool: Pool | null = null;
try {
  pool = getPool();
} catch {
  // Tests below will be skipped.
}

if (!pool) {
  test('stats db-backed tests', { skip: 'DATABASE_URL not set' }, () => {});
} else {
  async function resetDb() {
    await pool!.query(`
    TRUNCATE lobby_players, lobbies, agent_api_keys, agents, game_modes RESTART IDENTITY CASCADE;
  `);
  }

  async function createAgent() {
    const result = await pool!.query<IdRow>(
    `
    INSERT INTO agents (payout_address, name, version, status, metadata)
    VALUES ('0xTestWallet', 'Stats Agent', 'v1', 'ACTIVE', '{}'::jsonb)
    RETURNING id
    `
  );
    return result.rows[0].id;
  }

  async function createGameMode(durationSec: number) {
    const result = await pool!.query<IdRow>(
    `
    INSERT INTO game_modes (title, max_players, duration_sec, coins_per_match, reward_pool_quai, status)
    VALUES ('Coin Runner', 2, $1, 100, 10.0, 'ACTIVE')
    RETURNING id
    `,
    [durationSec]
  );
    return result.rows[0].id;
  }

  async function createLobby(gameModeId: string, status: 'WAITING' | 'ACTIVE', startedAt: Date | null) {
    const result = await pool!.query<IdRow>(
    `
    INSERT INTO lobbies (game_mode_id, watch_code, status, max_players, reward_pool_quai, started_at, created_at)
    VALUES ($1, 'STATS1', $2, 2, 10.0, $3, now())
    RETURNING id
    `,
    [gameModeId, status, startedAt]
  );
    return result.rows[0].id;
  }

  async function createWaitingLobbyWithCreatedAt(gameModeId: string, createdAt: Date) {
    const result = await pool!.query<IdRow>(
    `
    INSERT INTO lobbies (game_mode_id, watch_code, status, max_players, reward_pool_quai, created_at)
    VALUES ($1, 'STATS2', 'WAITING', 2, 10.0, $2)
    RETURNING id
    `,
    [gameModeId, createdAt]
  );
    return result.rows[0].id;
  }

  async function joinLobby(lobbyId: string, agentId: string) {
    await pool!.query(
    `
    INSERT INTO lobby_players (lobby_id, agent_id, slot, status)
    VALUES ($1, $2, 0, 'JOINED')
    `,
    [lobbyId, agentId]
  );
  }

  const app = buildServer();

  test.before(async () => {
    await pool!.query('SELECT 1');
  });

  test('stats agents_playing excludes expired ACTIVE lobbies', async () => {
    await resetDb();
    const agentId = await createAgent();
    const gameModeId = await createGameMode(10);

    // Expired: started 2 minutes ago with duration 10s.
    const started = new Date(Date.now() - 2 * 60 * 1000);
    const lobbyId = await createLobby(gameModeId, 'ACTIVE', started);
    await joinLobby(lobbyId, agentId);

    const res = await app.inject({ method: 'GET', url: '/stats' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.agents_playing, 0);
  });

  test('stats agents_playing includes WAITING lobbies', async () => {
    await resetDb();
    const agentId = await createAgent();
    const gameModeId = await createGameMode(120);

    const lobbyId = await createLobby(gameModeId, 'WAITING', null);
    await joinLobby(lobbyId, agentId);

    const res = await app.inject({ method: 'GET', url: '/stats' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.agents_playing, 1);
  });

  test('stats agents_playing excludes stale WAITING lobbies', async () => {
    await resetDb();
    const agentId = await createAgent();
    const gameModeId = await createGameMode(120);

    // Created 2 hours ago: should not count as "playing" anymore.
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const lobbyId = await createWaitingLobbyWithCreatedAt(gameModeId, createdAt);
    await joinLobby(lobbyId, agentId);

    const res = await app.inject({ method: 'GET', url: '/stats' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.agents_playing, 0);
  });

  test.after(async () => {
    await app.close();
    await pool!.end();
  });
}
