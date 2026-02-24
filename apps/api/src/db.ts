import { Pool } from 'pg';
import { config } from './config.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required for database access');
  }
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    idleTimeoutMillis: config.databasePoolIdleTimeoutMs,
    connectionTimeoutMillis: config.databasePoolConnectionTimeoutMs
  });
  return pool;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
