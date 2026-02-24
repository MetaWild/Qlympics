import { randomBytes } from 'crypto';
import { ensureRedisConnected, redisClient } from '../redis/client.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseHexNonce(value: unknown): bigint {
  if (typeof value !== 'string' || !value.startsWith('0x')) {
    throw new Error(`Invalid nonce hex: ${String(value)}`);
  }
  return BigInt(value);
}

async function withRedisLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  await ensureRedisConnected();
  const token = randomBytes(16).toString('hex');

  const start = Date.now();
  while (true) {
    const ok = await redisClient.set(key, token, { NX: true, PX: ttlMs });
    if (ok) break;
    if (Date.now() - start > 30_000) {
      throw new Error(`Timed out acquiring redis lock: ${key}`);
    }
    await sleep(25);
  }

  try {
    return await fn();
  } finally {
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
}

export async function reserveTreasuryNonces(opts: {
  fromAddress: string;
  chainId: number;
  count: number;
  // Any provider with a `send(method, params)` function.
  provider: { send: (method: string, params: unknown[]) => Promise<unknown> };
}): Promise<bigint> {
  const { fromAddress, chainId, count, provider } = opts;
  if (count <= 0) throw new Error(`Invalid nonce reservation count: ${count}`);

  const nonceKey = `treasury:nonce:${chainId}:${fromAddress.toLowerCase()}:next`;
  const lockKey = `treasury:nonce:${chainId}:${fromAddress.toLowerCase()}:lock`;

  return await withRedisLock(lockKey, 2_000, async () => {
    // Always consult the chain once per reservation to avoid stale redis state across restarts.
    const chainNonceHex = await provider.send('eth_getTransactionCount', [fromAddress, 'pending']);
    const chainNonce = parseHexNonce(chainNonceHex);

    const redisNextRaw = await redisClient.get(nonceKey);
    const redisNext = redisNextRaw ? BigInt(redisNextRaw) : 0n;

    const startNonce = redisNext > chainNonce ? redisNext : chainNonce;
    const nextNonce = startNonce + BigInt(count);
    await redisClient.set(nonceKey, nextNonce.toString());

    return startNonce;
  });
}

