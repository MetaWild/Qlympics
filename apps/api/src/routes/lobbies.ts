import { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import { getPool } from '../db.js';
import { getApiKeyFromHeaders, getAgentByApiKey } from '../auth.js';
import { ensureRedisConnected, redisClient } from '../redis/client.js';
import { buildInputEvent, Direction } from '../events/input.js';
import { GAME_GRID_HEIGHT, GAME_GRID_WIDTH, GAME_TICK_RATE } from '../game/constants.js';

type LobbyRow = {
  id: string;
  game_mode_id: string;
  watch_code: string;
  status: string;
  max_players: number;
  reward_pool_quai: string;
  joined_players: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  seed: number | null;
  title: string;
};

type ExistingJoinRow = {
  lobby_id: string;
  watch_code: string;
  status: string;
  slot: number;
};

type GameModeRow = {
  id: string;
  max_players: number;
  duration_sec: number;
  coins_per_match: number;
  reward_pool_quai: string;
};

type SlotRow = { slot: number };

type PlayerRow = {
  agent_id: string;
  slot: number;
};

type LobbyPlayerInfoRow = {
  agent_id: string;
  slot: number;
  status: string;
  runtime_identity: string;
  payout_address: string;
};

const WATCH_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateWatchCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += WATCH_CODE_CHARS[bytes[i] % WATCH_CODE_CHARS.length];
  }
  return code;
}

export async function registerLobbyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/lobbies', async () => {
    const client = await getPool().connect();
    try {
      const result = await client.query<LobbyRow>(
        `
        SELECT l.id, l.game_mode_id, l.watch_code, l.status, l.max_players, l.reward_pool_quai,
               COALESCE(j.joined_players, 0) AS joined_players,
               l.created_at, l.started_at, l.finished_at, l.seed, g.title
        FROM lobbies l
        JOIN game_modes g ON g.id = l.game_mode_id
        LEFT JOIN (
          SELECT lobby_id, COUNT(*) FILTER (WHERE status = 'JOINED')::int AS joined_players
          FROM lobby_players
          GROUP BY lobby_id
        ) j ON j.lobby_id = l.id
        WHERE l.status IN ('WAITING', 'ACTIVE', 'FINISHED')
          AND (
            (
              l.status = 'WAITING'
              AND now() < l.created_at + interval '30 minutes'
            )
            OR (
              l.status = 'ACTIVE'
              AND l.started_at IS NOT NULL
              AND now() < l.started_at + ((g.duration_sec::text || ' seconds')::interval) + interval '30 seconds'
            )
            OR (
              l.status = 'FINISHED'
              AND l.finished_at IS NOT NULL
              AND now() < l.finished_at + interval '30 seconds'
            )
          )
        ORDER BY l.created_at DESC
        `
      );
      return result.rows;
    } finally {
      client.release();
    }
  });

  app.get('/lobbies/by-watch-code/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    if (!code || code.length !== 6) {
      return reply.code(400).send({ error: 'Invalid watch code.' });
    }
    const client = await getPool().connect();
    try {
      const result = await client.query<LobbyRow>(
        `
        SELECT l.id, l.game_mode_id, l.watch_code, l.status, l.max_players, l.reward_pool_quai,
               COALESCE(j.joined_players, 0) AS joined_players,
               l.created_at, l.started_at, l.finished_at, l.seed, g.title
        FROM lobbies l
        JOIN game_modes g ON g.id = l.game_mode_id
        LEFT JOIN (
          SELECT lobby_id, COUNT(*) FILTER (WHERE status = 'JOINED')::int AS joined_players
          FROM lobby_players
          GROUP BY lobby_id
        ) j ON j.lobby_id = l.id
        WHERE l.watch_code = $1
          AND l.status IN ('WAITING', 'ACTIVE', 'FINISHED')
          AND (
            (
              l.status = 'WAITING'
              AND now() < l.created_at + interval '30 minutes'
            )
            OR (
              l.status = 'ACTIVE'
              AND l.started_at IS NOT NULL
              AND now() < l.started_at + ((g.duration_sec::text || ' seconds')::interval) + interval '30 seconds'
            )
            OR (
              l.status = 'FINISHED'
              AND l.finished_at IS NOT NULL
              AND now() < l.finished_at + interval '30 seconds'
            )
          )
        LIMIT 1
        `,
        [code.toUpperCase()]
      );
      const lobby = result.rows[0];
      if (!lobby) {
        return reply.code(404).send({ error: 'Lobby not found.' });
      }
      return lobby;
    } finally {
      client.release();
    }
  });

  app.get('/lobbies/:lobbyId/result', async (request, reply) => {
    const { lobbyId } = request.params as { lobbyId: string };
    const client = await getPool().connect();
    try {
      const result = await client.query(
        `
        SELECT lp.agent_id, lp.final_coins, lp.final_reward_quai, a.runtime_identity, a.payout_address
        FROM lobby_players lp
        JOIN agents a ON a.id = lp.agent_id
        WHERE lp.lobby_id = $1
        ORDER BY lp.final_reward_quai DESC
        `,
        [lobbyId]
      );
      if (!result.rows.length) {
        return reply.code(404).send({ error: 'Lobby result not found.' });
      }
      return { lobby_id: lobbyId, results: result.rows };
    } finally {
      client.release();
    }
  });

  // UI helper: fetch the current live lobby state from Redis (written by the game server).
  app.get('/lobbies/:lobbyId/state', async (request, reply) => {
    const { lobbyId } = request.params as { lobbyId: string };
    await ensureRedisConnected();
    const payload = await redisClient.get(`lobby:${lobbyId}:state`);
    if (!payload) {
      return reply.code(404).send({ error: 'Lobby state not found.' });
    }
    try {
      return JSON.parse(payload);
    } catch {
      return reply.code(500).send({ error: 'Invalid lobby state payload.' });
    }
  });

  // UI helper: map agent ids in a lobby to runtime identities (for leaderboard labels).
  app.get('/lobbies/:lobbyId/players', async (request, reply) => {
    const { lobbyId } = request.params as { lobbyId: string };
    const client = await getPool().connect();
    try {
      const result = await client.query<LobbyPlayerInfoRow>(
        `
        SELECT lp.agent_id, lp.slot, lp.status, a.runtime_identity, a.payout_address
        FROM lobby_players lp
        JOIN agents a ON a.id = lp.agent_id
        WHERE lp.lobby_id = $1
        ORDER BY lp.slot ASC
        `,
        [lobbyId]
      );
      if (!result.rows.length) {
        return reply.code(404).send({ error: 'Lobby players not found.' });
      }
      return result.rows;
    } finally {
      client.release();
    }
  });

  app.post('/lobbies/join', async (request, reply) => {
    const apiKey = getApiKeyFromHeaders(request.headers as Record<string, unknown>);
    if (!apiKey) {
      return reply.code(401).send({ error: 'x-api-key header required' });
    }

    const agent = await getAgentByApiKey(apiKey);
    if (!agent) {
      return reply.code(401).send({ error: 'Invalid api key.' });
    }

    const body = request.body as { game_mode_id?: string };
    if (!body?.game_mode_id) {
      return reply.code(400).send({ error: 'game_mode_id is required' });
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<ExistingJoinRow>(
        `
        SELECT l.id AS lobby_id, l.watch_code, l.status, lp.slot
        FROM lobby_players lp
        JOIN lobbies l ON l.id = lp.lobby_id
        WHERE lp.agent_id = $1
          AND lp.status = 'JOINED'
          AND l.status IN ('WAITING', 'ACTIVE')
        LIMIT 1
        `,
        [agent.id]
      );

      if (existing.rows[0]) {
        await client.query('COMMIT');
        await ensureRedisConnected();
        await redisClient.sAdd(`lobby:${existing.rows[0].lobby_id}:players`, agent.id);
        return existing.rows[0];
      }

      const gameModes = await client.query<GameModeRow>(
        `
        SELECT id, max_players, duration_sec, coins_per_match, reward_pool_quai
        FROM game_modes
        WHERE id = $1 AND status = 'ACTIVE'
        `,
        [body.game_mode_id]
      );

      const gameMode = gameModes.rows[0];
      if (!gameMode) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Game mode not found.' });
      }

      let lobby = await client.query<LobbyRow>(
        `
        SELECT id, game_mode_id, watch_code, status, max_players, reward_pool_quai,
               created_at, started_at, finished_at, seed
        FROM lobbies
        WHERE game_mode_id = $1 AND status = 'WAITING'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE
        `,
        [gameMode.id]
      );

      let lobbyRow: LobbyRow | null = lobby.rows[0] ?? null;

      if (lobbyRow) {
        const slots = await client.query<SlotRow>(
          `
          SELECT slot
          FROM lobby_players
          WHERE lobby_id = $1 AND status = 'JOINED'
          ORDER BY slot ASC
          `,
          [lobbyRow.id]
        );

        if (slots.rows.length >= lobbyRow.max_players) {
          lobbyRow = null;
        } else {
          const used = new Set(slots.rows.map((row) => row.slot));
          let assignedSlot = 0;
          for (let i = 0; i < lobbyRow.max_players; i += 1) {
            if (!used.has(i)) {
              assignedSlot = i;
              break;
            }
          }

          await client.query(
            `
            INSERT INTO lobby_players (lobby_id, agent_id, slot, status)
            VALUES ($1, $2, $3, 'JOINED')
            `,
            [lobbyRow.id, agent.id, assignedSlot]
          );

          const newCount = slots.rows.length + 1;
          if (newCount >= lobbyRow.max_players) {
            await client.query(
              `
              UPDATE lobbies
              SET status = 'ACTIVE', started_at = now()
              WHERE id = $1
              `,
              [lobbyRow.id]
            );
            lobbyRow.status = 'ACTIVE';
            lobbyRow.started_at = new Date().toISOString();
          }

          await client.query('COMMIT');

          await ensureRedisConnected();
          await redisClient.sAdd(`lobby:${lobbyRow.id}:players`, agent.id);
          if (lobbyRow.status === 'ACTIVE') {
            const config = {
              lobby_id: lobbyRow.id,
              width: GAME_GRID_WIDTH,
              height: GAME_GRID_HEIGHT,
              tick_rate: GAME_TICK_RATE,
              duration_sec: gameMode.duration_sec,
              coins_per_match: gameMode.coins_per_match,
              reward_pool_quai: lobbyRow.reward_pool_quai,
              seed: lobbyRow.seed ?? Math.floor(Math.random() * 1e9),
              started_at: lobbyRow.started_at
            };
            await redisClient.set(`lobby:${lobbyRow.id}:config`, JSON.stringify(config));
            await redisClient.sAdd('lobbies:active', lobbyRow.id);
          }

          return {
            lobby_id: lobbyRow.id,
            watch_code: lobbyRow.watch_code,
            status: lobbyRow.status,
            slot: assignedSlot
          };
        }
      }

      const watchCodeAttempts = 5;
      let createdLobby: LobbyRow | null = null;
      for (let attempt = 0; attempt < watchCodeAttempts; attempt += 1) {
        const watchCode = generateWatchCode();
        try {
          const created = await client.query<LobbyRow>(
            `
            INSERT INTO lobbies (game_mode_id, watch_code, status, max_players, reward_pool_quai, seed)
            VALUES ($1, $2, 'WAITING', $3, $4, $5)
            RETURNING id, game_mode_id, watch_code, status, max_players, reward_pool_quai,
                      created_at, started_at, finished_at, seed
            `,
            [gameMode.id, watchCode, gameMode.max_players, gameMode.reward_pool_quai, Math.floor(Math.random() * 1e9)]
          );
          createdLobby = created.rows[0];
          break;
        } catch (error: any) {
          if (error?.code === '23505') {
            continue;
          }
          throw error;
        }
      }

      if (!createdLobby) {
        await client.query('ROLLBACK');
        return reply.code(500).send({ error: 'Unable to allocate watch code.' });
      }

      await client.query(
        `
        INSERT INTO lobby_players (lobby_id, agent_id, slot, status)
        VALUES ($1, $2, $3, 'JOINED')
        `,
        [createdLobby.id, agent.id, 0]
      );

      if (gameMode.max_players === 1) {
        const started = await client.query<{ started_at: string }>(
          `
          UPDATE lobbies
          SET status = 'ACTIVE', started_at = now()
          WHERE id = $1
          RETURNING started_at
          `,
          [createdLobby.id]
        );
        createdLobby.status = 'ACTIVE';
        createdLobby.started_at = started.rows[0]?.started_at ?? new Date().toISOString();
      }

      await client.query('COMMIT');

      await ensureRedisConnected();
      await redisClient.sAdd(`lobby:${createdLobby.id}:players`, agent.id);
      if (createdLobby.status === 'ACTIVE') {
        const config = {
          lobby_id: createdLobby.id,
          width: GAME_GRID_WIDTH,
          height: GAME_GRID_HEIGHT,
          tick_rate: GAME_TICK_RATE,
          duration_sec: gameMode.duration_sec,
          coins_per_match: gameMode.coins_per_match,
          reward_pool_quai: createdLobby.reward_pool_quai,
          seed: createdLobby.seed ?? Math.floor(Math.random() * 1e9),
          started_at: createdLobby.started_at
        };
        await redisClient.set(`lobby:${createdLobby.id}:config`, JSON.stringify(config));
        await redisClient.sAdd('lobbies:active', createdLobby.id);
      }

      return {
        lobby_id: createdLobby.id,
        watch_code: createdLobby.watch_code,
        status: createdLobby.status,
        slot: 0
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/lobbies/leave', async (request, reply) => {
    const apiKey = getApiKeyFromHeaders(request.headers as Record<string, unknown>);
    if (!apiKey) {
      return reply.code(401).send({ error: 'x-api-key header required' });
    }

    const agent = await getAgentByApiKey(apiKey);
    if (!agent) {
      return reply.code(401).send({ error: 'Invalid api key.' });
    }

    const body = request.body as { lobby_id?: string };
    if (!body?.lobby_id) {
      return reply.code(400).send({ error: 'lobby_id is required' });
    }

    const result = await getPool().query(
      `
      UPDATE lobby_players
      SET status = 'LEFT', left_at = now()
      WHERE lobby_id = $1 AND agent_id = $2 AND status = 'JOINED'
      RETURNING lobby_id, agent_id
      `,
      [body.lobby_id, agent.id]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Agent is not in this lobby.' });
    }

    await ensureRedisConnected();
    await redisClient.sRem(`lobby:${body.lobby_id}:players`, agent.id);

    return { lobby_id: body.lobby_id, agent_id: agent.id, status: 'LEFT' };
  });

  app.post('/lobbies/:lobbyId/input', async (request, reply) => {
    const apiKey = getApiKeyFromHeaders(request.headers as Record<string, unknown>);
    if (!apiKey) {
      return reply.code(401).send({ error: 'x-api-key header required' });
    }

    const agent = await getAgentByApiKey(apiKey);
    if (!agent) {
      return reply.code(401).send({ error: 'Invalid api key.' });
    }

    const { lobbyId } = request.params as { lobbyId: string };
    const body = request.body as { direction?: Direction };
    const allowed = new Set(['up', 'down', 'left', 'right']);

    if (!body?.direction || !allowed.has(body.direction)) {
      return reply.code(400).send({ error: 'direction must be up, down, left, or right' });
    }

    const membership = await getPool().query<PlayerRow>(
      `
      SELECT lp.agent_id, lp.slot
      FROM lobby_players lp
      WHERE lp.lobby_id = $1 AND lp.agent_id = $2 AND lp.status = 'JOINED'
      `,
      [lobbyId, agent.id]
    );

    if (!membership.rows[0]) {
      return reply.code(404).send({ error: 'Agent not in lobby.' });
    }

    await ensureRedisConnected();
    const event = buildInputEvent(lobbyId, agent.id, body.direction);
    const eventJson = JSON.stringify(event);

    await redisClient.rPush(`lobby:${lobbyId}:inputs`, eventJson);
    await redisClient.publish(`pubsub:lobby:${lobbyId}`, eventJson);

    return {
      accepted: true,
      lobby_id: lobbyId,
      agent_id: agent.id,
      direction: body.direction
    };
  });
}
