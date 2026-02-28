import { ensureRedisConnected, redisClient } from './redis/client.js';
import { initLobbyState, stepLobbyState } from './state/engine.js';
import { LobbyConfig, LobbyInputEvent, LobbyState } from './state/types.js';
import { computePayouts } from './state/payouts.js';
import { pool } from './db.js';
import { lobbyWsHub, startGameWebSocketServer } from './ws/server.js';
import { sanitizeError } from './logging/sanitize.js';

const TICK_MS = 100;

async function loadConfig(lobbyId: string): Promise<LobbyConfig | null> {
  const raw = await redisClient.get(`lobby:${lobbyId}:config`);
  if (!raw) return null;
  return JSON.parse(raw) as LobbyConfig;
}

async function loadState(lobbyId: string): Promise<LobbyState | null> {
  const raw = await redisClient.get(`lobby:${lobbyId}:state`);
  if (!raw) return null;
  return JSON.parse(raw) as LobbyState;
}

async function saveState(lobbyId: string, state: LobbyState) {
  await redisClient.set(`lobby:${lobbyId}:state`, JSON.stringify(state));
}

async function drainInputs(lobbyId: string): Promise<LobbyInputEvent[]> {
  const listKey = `lobby:${lobbyId}:inputs`;
  const items = await redisClient.lRange(listKey, 0, -1);
  if (!items.length) {
    return [];
  }
  await redisClient.lTrim(listKey, items.length, -1);

  const events: LobbyInputEvent[] = [];
  for (const item of items) {
    try {
      const parsed = JSON.parse(item) as LobbyInputEvent;
      if (parsed.type === 'INPUT') {
        events.push(parsed);
      }
    } catch {
      continue;
    }
  }
  return events;
}

async function ensureInitialState(lobbyId: string, config: LobbyConfig): Promise<LobbyState> {
  const existing = await loadState(lobbyId);
  if (existing) return existing;

  const agents = await redisClient.sMembers(`lobby:${lobbyId}:players`);
  const state = initLobbyState(config, agents);
  await saveState(lobbyId, state);
  return state;
}

function syncPlayers(state: LobbyState, activeAgents: string[]): LobbyState {
  const activeSet = new Set(activeAgents);
  const nextPlayers: LobbyState['players'] = {};

  for (const [agentId, player] of Object.entries(state.players)) {
    if (activeSet.has(agentId)) {
      nextPlayers[agentId] = player;
    }
  }

  return { ...state, players: nextPlayers };
}

async function tickLobby(lobbyId: string) {
  const config = await loadConfig(lobbyId);
  if (!config) return;

  const now = new Date();
  let state = await ensureInitialState(lobbyId, config);
  const activeAgents = await redisClient.sMembers(`lobby:${lobbyId}:players`);
  state = syncPlayers(state, activeAgents);

  if (state.status === 'FINISHED') {
    await finalizeLobby(lobbyId, state, config);
    return;
  }

  const inputs = await drainInputs(lobbyId);
  state = stepLobbyState(state, config, inputs, now);

  if (state.status === 'FINISHED') {
    await finalizeLobby(lobbyId, state, config);
  }

  await redisClient.multi()
    .set(`lobby:${lobbyId}:state`, JSON.stringify(state))
    .incr(`lobby:${lobbyId}:seq`)
    .exec();

  // Lowest-latency live updates for watchers.
  lobbyWsHub.broadcastState(lobbyId, state);
}

async function tickLoop() {
  const lobbyIds = await redisClient.sMembers('lobbies:active');
  await Promise.all(lobbyIds.map((id) => tickLobby(id)));
}

async function finalizeLobby(lobbyId: string, state: LobbyState, config: LobbyConfig) {
  const finalizeKey = `lobby:${lobbyId}:finalized`;
  const claimed = await redisClient.set(finalizeKey, '1', { NX: true });
  if (!claimed) {
    await redisClient.sRem('lobbies:active', lobbyId);
    return;
  }

  const scores: Record<string, number> = {};
  for (const [agentId, player] of Object.entries(state.players)) {
    scores[agentId] = player.score;
  }

  const { totalQuai, breakdown } = computePayouts(config.reward_pool_quai, config.coins_per_match, scores);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lobbyUpdate = await client.query(
      `
      UPDATE lobbies
      SET status = 'FINISHED', finished_at = now()
      WHERE id = $1
      `,
      [lobbyId]
    );

    if (lobbyUpdate.rowCount === 0) {
      await client.query('ROLLBACK');
      await redisClient.sRem('lobbies:active', lobbyId);
      return;
    }

    const entries = Object.entries(scores);
    if (entries.length > 0) {
      const values: string[] = [];
      const params: Array<string | number> = [lobbyId];
      let idx = 2;
      for (const [agentId, score] of entries) {
        const reward = breakdown[agentId] ?? '0';
        values.push(`($1::uuid, $${idx}::uuid, $${idx + 1}::int, $${idx + 2}::numeric)`);
        params.push(agentId, score, reward);
        idx += 3;
      }

      await client.query(
        `
        UPDATE lobby_players AS lp
        SET final_coins = v.final_coins,
            final_reward_quai = v.final_reward_quai,
            status = 'FINISHED'::lobby_player_status
        FROM (VALUES ${values.join(',')})
          AS v(lobby_id, agent_id, final_coins, final_reward_quai)
        WHERE lp.lobby_id = v.lobby_id
          AND lp.agent_id = v.agent_id
        `,
        params
      );
    }

    const payoutResult = await client.query<{ id: string }>(
      `
      INSERT INTO payouts (lobby_id, status, from_wallet, total_quai, breakdown)
      VALUES ($1, 'PENDING', NULL, $2, $3::jsonb)
      ON CONFLICT (lobby_id) DO UPDATE SET lobby_id = EXCLUDED.lobby_id
      RETURNING id
      `,
      [lobbyId, totalQuai, JSON.stringify(breakdown)]
    );

    const payoutId = payoutResult.rows[0]?.id;
    const payoutAgents = Object.keys(breakdown);
    if (payoutId && payoutAgents.length > 0) {
      const agentRows = await client.query<{ id: string; payout_address: string }>(
        `SELECT id, payout_address FROM agents WHERE id = ANY($1::uuid[])`,
        [payoutAgents]
      );
      const agentMap = new Map(agentRows.rows.map((row) => [row.id, row.payout_address]));

      const values: string[] = [];
      const params: Array<string> = [payoutId];
      let idx = 2;
      for (const agentId of payoutAgents) {
        const payoutAddress = agentMap.get(agentId);
        if (!payoutAddress) {
          continue;
        }
        values.push(`($1::uuid, $${idx}::uuid, $${idx + 1}, $${idx + 2}::numeric)`);
        params.push(agentId, payoutAddress, breakdown[agentId]);
        idx += 3;
      }

      if (values.length > 0) {
        await client.query(
          `
          INSERT INTO payout_items (payout_id, agent_id, payout_address, amount_quai)
          VALUES ${values.join(',')}
          ON CONFLICT (payout_id, agent_id) DO NOTHING
          `,
          params
        );
      }
    }

    await client.query('COMMIT');

    // Kick off payout execution ASAP (best-effort). The API runs a subscriber worker that executes
    // payouts sequentially to avoid nonce collisions. If it's not running, payouts can still be
    // executed later via POST /payouts/execute.
    try {
      await redisClient.publish('pubsub:payouts', JSON.stringify({ lobby_id: lobbyId }));
    } catch {
      // Ignore; lobby finalization must not fail due to payout trigger issues.
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await redisClient.sRem('lobbies:active', lobbyId);
  }
}

async function main() {
  await ensureRedisConnected();
  startGameWebSocketServer();
  console.log('Game server tick loop started');
  setInterval(() => {
    tickLoop().catch((error) => console.error('Tick loop error', sanitizeError(error)));
  }, TICK_MS);
}

main().catch((error) => {
  console.error('Game server failed to start', sanitizeError(error));
  process.exit(1);
});
