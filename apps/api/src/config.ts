import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load env from current working dir first, then fall back to repo root (.env).
// This makes `npm --prefix apps/api ...` work whether cwd is repo root or apps/api.
dotenv.config();
try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(here, '..', '..', '.env') });
} catch {
  // best-effort
}

export type AppConfig = {
  port: number;
  databaseUrl: string;
  databasePoolMax: number;
  databasePoolIdleTimeoutMs: number;
  databasePoolConnectionTimeoutMs: number;
  redisUrl: string;
  quaiRpcUrl: string;
  quaiChainId: number;
  quaiTreasuryPrivateKey?: string;
  powDifficulty: number;
  powExpiresSeconds: number;
};

function requireNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number value: ${value}`);
  }
  return parsed;
}

export const config: AppConfig = {
  port: requireNumber(process.env.PORT, 3001),
  databaseUrl: process.env.DATABASE_URL ?? '',
  databasePoolMax: requireNumber(process.env.DATABASE_POOL_MAX, 20),
  databasePoolIdleTimeoutMs: requireNumber(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS, 30000),
  databasePoolConnectionTimeoutMs: requireNumber(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS, 5000),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  // For Quai's public RPC, prefer the base URL and enable pathing in the provider.
  // This avoids double-pathing issues like ".../cyprus1/cyprus1" when `usePathing: true`.
  quaiRpcUrl: process.env.QUAI_RPC_URL ?? 'https://orchard.rpc.quai.network',
  quaiChainId: requireNumber(process.env.QUAI_CHAIN_ID, 15000),
  quaiTreasuryPrivateKey: process.env.QUAI_TREASURY_PRIVATE_KEY,
  powDifficulty: requireNumber(process.env.POW_DIFFICULTY, 4),
  powExpiresSeconds: requireNumber(process.env.POW_EXPIRES_SECONDS, 300)
};
