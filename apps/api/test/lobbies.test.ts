import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { getPool } from '../src/db.js';
import { hashApiKey } from '../src/auth.js';
import { redisClient } from '../src/redis/client.js';
import type { Pool } from 'pg';

type IdRow = { id: string };

let pool: Pool | null = null;
try {
  pool = getPool();
} catch {
  // Tests below will be skipped.
}

if (!pool) {
  test('lobbies db-backed tests', { skip: 'DATABASE_URL not set' }, () => {});
} else {
  test.before(async () => {
    await pool!.query('SELECT 1');
  });

  async function resetDb() {
    await pool!.query(`
    TRUNCATE lobby_players, lobbies, agent_api_keys, agents, game_modes RESTART IDENTITY CASCADE;
  `);
  }

  async function createGameMode(maxPlayers: number) {
    const result = await pool!.query<IdRow>(
    `
    INSERT INTO game_modes (title, max_players, duration_sec, coins_per_match, reward_pool_quai, status)
    VALUES ('Coin Runner', $1, 120, 100, 10.0, 'ACTIVE')
    RETURNING id
    `,
    [maxPlayers]
  );
    return result.rows[0].id;
  }

  async function createAgentWithKey(apiKey: string, runtimeIdentity?: string) {
    const agent = await pool!.query<IdRow>(
    `
    INSERT INTO agents (runtime_identity, payout_address, name, version, status, metadata)
    VALUES ($1, '0xTestWallet', 'Test Agent', 'v1', 'ACTIVE', '{}'::jsonb)
    RETURNING id
    `
    ,
    [runtimeIdentity ?? 'agent']
  );
    const agentId = agent.rows[0].id;
    const keyHash = hashApiKey(apiKey);
    await pool!.query(
    `
    INSERT INTO agent_api_keys (agent_id, key_hash)
    VALUES ($1, $2)
    `,
    [agentId, keyHash]
  );
    return agentId;
  }

  const app = buildServer();

  async function joinLobby(apiKey: string, gameModeId: string) {
    return app.inject({
      method: 'POST',
      url: '/lobbies/join',
      headers: { 'x-api-key': apiKey },
      payload: { game_mode_id: gameModeId }
    });
  }

  test('lobby join assigns slots and activates when full', async () => {
    await resetDb();

    const gameModeId = await createGameMode(2);
    const apiKeyOne = 'api-key-one';
    const apiKeyTwo = 'api-key-two';
    await createAgentWithKey(apiKeyOne);
    await createAgentWithKey(apiKeyTwo);

    const first = await joinLobby(apiKeyOne, gameModeId);
    assert.equal(first.statusCode, 200);
    const firstBody = first.json();
    assert.equal(firstBody.status, 'WAITING');
    assert.equal(firstBody.slot, 0);

    const second = await joinLobby(apiKeyTwo, gameModeId);
    assert.equal(second.statusCode, 200);
    const secondBody = second.json();
    assert.equal(secondBody.status, 'ACTIVE');
    assert.equal(secondBody.slot, 1);

    const lobbyStatus = await pool!.query<{ status: string }>('SELECT status FROM lobbies WHERE id = $1', [
      secondBody.lobby_id
    ]);
    assert.equal(lobbyStatus.rows[0].status, 'ACTIVE');
  });

  test('lobby auto-activates when max_players is 1', async () => {
    await resetDb();

    const gameModeId = await createGameMode(1);
    const apiKey = 'api-key-single';
    await createAgentWithKey(apiKey);

    const joined = await joinLobby(apiKey, gameModeId);
    assert.equal(joined.statusCode, 200);
    const body = joined.json();
    assert.equal(body.status, 'ACTIVE');
    assert.equal(body.slot, 0);

    const lobbyStatus = await pool!.query<{ status: string; started_at: string | null }>(
      'SELECT status, started_at FROM lobbies WHERE id = $1',
      [body.lobby_id]
    );
    assert.equal(lobbyStatus.rows[0].status, 'ACTIVE');
    assert.ok(lobbyStatus.rows[0].started_at);
  });

  test('lobby leave marks player as left', async () => {
    await resetDb();

    const gameModeId = await createGameMode(2);
    const apiKey = 'api-key-leave';
    await createAgentWithKey(apiKey);

    const joined = await joinLobby(apiKey, gameModeId);
    const lobbyId = joined.json().lobby_id;

    const response = await app.inject({
      method: 'POST',
      url: '/lobbies/leave',
      headers: { 'x-api-key': apiKey },
      payload: { lobby_id: lobbyId }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, 'LEFT');

    const statusCheck = await pool!.query<{ status: string }>('SELECT status FROM lobby_players WHERE lobby_id = $1', [
      lobbyId
    ]);
    assert.equal(statusCheck.rows[0].status, 'LEFT');
  });

  test('input endpoint validates direction and membership', async () => {
    await resetDb();

    const gameModeId = await createGameMode(2);
    const apiKey = 'api-key-input';
    await createAgentWithKey(apiKey);

    const joined = await joinLobby(apiKey, gameModeId);
    const lobbyId = joined.json().lobby_id;

    const bad = await app.inject({
      method: 'POST',
      url: `/lobbies/${lobbyId}/input`,
      headers: { 'x-api-key': apiKey },
      payload: { direction: 'jump' }
    });
    assert.equal(bad.statusCode, 400);

    const ok = await app.inject({
      method: 'POST',
      url: `/lobbies/${lobbyId}/input`,
      headers: { 'x-api-key': apiKey },
      payload: { direction: 'up' }
    });
    assert.equal(ok.statusCode, 200);
    const okBody = ok.json();
    assert.equal(okBody.accepted, true);
  });

  test('lobby players endpoint includes runtime identities for leaderboard labels', async () => {
    await resetDb();

    const gameModeId = await createGameMode(2);
    const apiKeyOne = 'api-key-player-one';
    const apiKeyTwo = 'api-key-player-two';
    await createAgentWithKey(apiKeyOne, 'player1');
    await createAgentWithKey(apiKeyTwo, 'player2');

    const firstJoin = await joinLobby(apiKeyOne, gameModeId);
    const secondJoin = await joinLobby(apiKeyTwo, gameModeId);
    assert.equal(firstJoin.statusCode, 200);
    assert.equal(secondJoin.statusCode, 200);
    const lobbyId = firstJoin.json().lobby_id;

    const playersRes = await app.inject({
      method: 'GET',
      url: `/lobbies/${lobbyId}/players`
    });
    assert.equal(playersRes.statusCode, 200);
    const players = playersRes.json();

    assert.equal(players.length, 2);
    assert.equal(players[0].runtime_identity, 'player1');
    assert.equal(players[1].runtime_identity, 'player2');
  });

  test.after(async () => {
    await app.close();
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
    await pool!.end();
  });
}
