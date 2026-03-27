import { randomBytes } from 'crypto';
import { ensureRedisConnected, redisClient } from '../redis/client.js';

const LOCK_TTL_MS = 120_000; // 2 minutes max hold time per payout execution

/**
 * Acquire a distributed lock for a specific payout execution.
 * Prevents the auto-payout worker and the POST /payouts/execute route
 * from processing the same payout concurrently (which would cause double-sends).
 *
 * Returns a token string on success, or null if the lock is already held.
 */
export async function acquirePayoutLock(payoutId: string): Promise<string | null> {
  await ensureRedisConnected();
  const token = randomBytes(16).toString('hex');
  const key = `payout:exec:lock:${payoutId}`;
  const ok = await redisClient.set(key, token, { NX: true, PX: LOCK_TTL_MS });
  return ok ? token : null;
}

/**
 * Release the payout execution lock (only if we still hold it).
 */
export async function releasePayoutLock(payoutId: string, token: string): Promise<void> {
  await ensureRedisConnected();
  const key = `payout:exec:lock:${payoutId}`;
  const lua = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await redisClient.eval(lua, { keys: [key], arguments: [token] });
  } catch {
    // best-effort
  }
}
