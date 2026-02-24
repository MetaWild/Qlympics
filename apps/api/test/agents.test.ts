import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { buildServer } from '../src/server.js';
import { getPool } from '../src/db.js';
import { computePowHash, meetsDifficulty } from '../src/pow.js';

type ChallengeResponse = {
  challenge_id: string;
  nonce: string;
  difficulty: number;
};

let pool: Pool | null = null;
try {
  pool = getPool();
} catch {
  // Tests below will be skipped.
}

function solvePow(nonce: string, difficulty: number): string {
  for (let i = 0; i < 1_000_000; i += 1) {
    const candidate = `sol-${i}`;
    const hash = computePowHash(nonce, candidate);
    if (meetsDifficulty(hash, difficulty)) {
      return candidate;
    }
  }
  throw new Error(`Could not solve PoW (difficulty=${difficulty})`);
}

if (!pool) {
  test('agents db-backed tests', { skip: 'DATABASE_URL not set' }, () => {});
} else {
  const app = buildServer();

  test.before(async () => {
    await pool!.query('SELECT 1');
  });

  async function resetDb() {
    await pool!.query(`
      TRUNCATE agent_pow_challenges, agent_api_keys, agents RESTART IDENTITY CASCADE;
    `);
  }

  async function verifyAgent(runtimeIdentity: string) {
    const challengeRes = await app.inject({
      method: 'POST',
      url: '/agents/challenge'
    });
    assert.equal(challengeRes.statusCode, 200);
    const challenge = challengeRes.json() as ChallengeResponse;
    const solution = solvePow(challenge.nonce, challenge.difficulty);

    return app.inject({
      method: 'POST',
      url: '/agents/verify',
      payload: {
        challenge_id: challenge.challenge_id,
        solution,
        runtime_identity: runtimeIdentity,
        payout_address: '0xTestWallet',
        name: `Agent-${runtimeIdentity}`,
        version: 'v1'
      }
    });
  }

  test('agents verify accepts duplicate runtime_identity values', async () => {
    await resetDb();

    const first = await verifyAgent('botalpha');
    assert.equal(first.statusCode, 200);
    const second = await verifyAgent('botalpha');
    assert.equal(second.statusCode, 200);

    const rows = await pool!.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM agents WHERE runtime_identity = 'botalpha'`
    );
    assert.equal(Number(rows.rows[0].count), 2);
  });

  test('agents verify rejects invalid runtime_identity values', async () => {
    await resetDb();

    const empty = await verifyAgent('');
    assert.equal(empty.statusCode, 400);

    const tooLong = await verifyAgent('toolongname11');
    assert.equal(tooLong.statusCode, 400);

    const badChars = await verifyAgent('bad name');
    assert.equal(badChars.statusCode, 400);

    const reserved = await verifyAgent('admin');
    assert.equal(reserved.statusCode, 400);
  });

  test.after(async () => {
    await app.close();
    await pool!.end();
  });
}
