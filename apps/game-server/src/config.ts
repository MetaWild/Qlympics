import dotenv from 'dotenv';

dotenv.config();

export const config = {
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  databaseUrl: process.env.DATABASE_URL || '',
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX || '20'),
  databasePoolIdleTimeoutMs: Number(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS || '30000'),
  databasePoolConnectionTimeoutMs: Number(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || '5000'),
  wsPort: Number(process.env.GAME_WS_PORT || '3003')
};
