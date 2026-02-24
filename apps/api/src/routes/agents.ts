import { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import { config } from '../config.js';
import { query } from '../db.js';
import { verifyPow } from '../pow.js';
import { getApiKeyFromHeaders, getAgentByApiKey, hashApiKey } from '../auth.js';
import { generateRuntimeIdentity, validateRuntimeIdentity } from '../runtimeIdentity.js';

type PowChallengeRow = {
  id: string;
  nonce: string;
  difficulty: number;
  expires_at: string;
  used_at: string | null;
};

type AgentRow = {
  id: string;
  runtime_identity: string;
  payout_address: string | null;
  name: string | null;
  version: string | null;
  status: string;
  last_seen_at: string | null;
};

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/agents/challenge', async () => {
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + config.powExpiresSeconds * 1000);

    const rows = await query<PowChallengeRow>(
      `
      INSERT INTO agent_pow_challenges (nonce, difficulty, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id, nonce, difficulty, expires_at, used_at
      `,
      [nonce, config.powDifficulty, expiresAt]
    );

    const challenge = rows[0];

    return {
      challenge_id: challenge.id,
      nonce: challenge.nonce,
      difficulty: challenge.difficulty,
      expires_at: challenge.expires_at
    };
  });

  app.post('/agents/verify', async (request, reply) => {
    const body = request.body as {
      challenge_id?: string;
      solution?: string;
      runtime_identity?: string;
      payout_address?: string;
      name?: string;
      version?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body?.challenge_id || !body?.solution) {
      return reply.code(400).send({ error: 'challenge_id and solution are required' });
    }

    if (!body?.payout_address || body.payout_address.trim().length === 0) {
      return reply.code(400).send({ error: 'payout_address is required' });
    }

    const runtimeIdentity =
      body.runtime_identity === undefined ? generateRuntimeIdentity() : body.runtime_identity.trim();
    const runtimeIdentityError = validateRuntimeIdentity(runtimeIdentity);
    if (runtimeIdentityError) {
      return reply.code(400).send({ error: runtimeIdentityError });
    }

    const rows = await query<PowChallengeRow>(
      `
      SELECT id, nonce, difficulty, expires_at, used_at
      FROM agent_pow_challenges
      WHERE id = $1
      `,
      [body.challenge_id]
    );

    const challenge = rows[0];

    if (!challenge) {
      return reply.code(404).send({ error: 'Challenge not found.' });
    }

    if (challenge.used_at) {
      return reply.code(400).send({ error: 'Challenge already used.' });
    }

    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      return reply.code(400).send({ error: 'Challenge expired.' });
    }

    const valid = verifyPow(challenge.nonce, body.solution, challenge.difficulty);
    if (!valid) {
      return reply.code(400).send({ error: 'Invalid proof-of-work solution.' });
    }

    await query(
      `
      UPDATE agent_pow_challenges
      SET used_at = now()
      WHERE id = $1
      `,
      [challenge.id]
    );

    const payoutAddress = body.payout_address.trim();
    const agentRows = await query<AgentRow>(
      `
      INSERT INTO agents (runtime_identity, payout_address, name, version, status, metadata)
      VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
      RETURNING id, runtime_identity, payout_address, name, version, status, last_seen_at
      `,
      [runtimeIdentity, payoutAddress, body.name ?? null, body.version ?? null, body.metadata ?? {}]
    );

    const agent = agentRows[0];
    const apiKey = randomBytes(32).toString('base64url');
    const keyHash = hashApiKey(apiKey);

    await query(
      `
      INSERT INTO agent_api_keys (agent_id, key_hash)
      VALUES ($1, $2)
      `,
      [agent.id, keyHash]
    );

    return {
      agent_id: agent.id,
      api_key: apiKey
    };
  });

  app.get('/agents/me', async (request, reply) => {
    const apiKey = getApiKeyFromHeaders(request.headers as Record<string, unknown>);
    if (!apiKey) {
      return reply.code(401).send({ error: 'x-api-key header required' });
    }
    const agent = await getAgentByApiKey(apiKey);
    if (!agent) {
      return reply.code(401).send({ error: 'Invalid api key.' });
    }
    return agent;
  });

  app.post('/agents/register-runtime', async (request, reply) => {
    return reply.code(501).send({ error: 'Runtime registration not implemented yet.' });
  });

  app.put('/agents/payout-address', async (request, reply) => {
    const apiKey = getApiKeyFromHeaders(request.headers as Record<string, unknown>);
    if (!apiKey) {
      return reply.code(401).send({ error: 'x-api-key header required' });
    }

    const agent = await getAgentByApiKey(apiKey);
    if (!agent) {
      return reply.code(401).send({ error: 'Invalid api key.' });
    }

    const body = request.body as { payout_address?: string };
    if (!body?.payout_address || body.payout_address.trim().length === 0) {
      return reply.code(400).send({ error: 'payout_address is required' });
    }

    const payoutAddress = body.payout_address.trim();
    const rows = await query<AgentRow>(
      `
      UPDATE agents
      SET payout_address = $1
      WHERE id = $2
      RETURNING id, runtime_identity, payout_address, name, version, status, last_seen_at
      `,
      [payoutAddress, agent.id]
    );

    return rows[0];
  });

  app.post('/agents/heartbeat', async (request, reply) => {
    const apiKey = getApiKeyFromHeaders(request.headers as Record<string, unknown>);
    if (!apiKey) {
      return reply.code(401).send({ error: 'x-api-key header required' });
    }

    const agent = await getAgentByApiKey(apiKey);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found.' });
    }

    const rows = await query<AgentRow>(
      `
      UPDATE agents
      SET last_seen_at = now(), status = 'ACTIVE'
      WHERE id = $1
      RETURNING id, runtime_identity, payout_address, name, version, status, last_seen_at
      `,
      [agent.id]
    );

    return rows[0];
  });
}
