import { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { query } from '../db.js';
import { ensureRedisConnected, redisClient } from '../redis/client.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    let db: 'ok' | 'disabled' | 'error' = 'disabled';
    if (config.databaseUrl) {
      try {
        await query('SELECT 1');
        db = 'ok';
      } catch {
        db = 'error';
      }
    }

    let redis: 'ok' | 'error' = 'error';
    try {
      await ensureRedisConnected();
      const pong = await redisClient.ping();
      redis = pong === 'PONG' ? 'ok' : 'error';
    } catch {
      redis = 'error';
    }

    const status = db === 'error' || redis === 'error' ? 'degraded' : 'ok';

    return {
      status,
      timestamp: new Date().toISOString(),
      components: {
        db,
        redis
      }
    };
  });
}
