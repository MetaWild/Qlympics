import { createClient } from 'redis';
import { config } from '../config.js';
import { sanitizeError } from '../logging/sanitize.js';

export const redisClient = createClient({ url: config.redisUrl });

redisClient.on('error', (error) => {
  console.error('Redis error', sanitizeError(error));
});

export async function ensureRedisConnected() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}
