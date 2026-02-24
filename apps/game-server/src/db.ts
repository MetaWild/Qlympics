import { Pool } from 'pg';
import { config } from './config.js';

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required for game server DB access');
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,
  idleTimeoutMillis: config.databasePoolIdleTimeoutMs,
  connectionTimeoutMillis: config.databasePoolConnectionTimeoutMs
});
