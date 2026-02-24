import { createClient } from 'redis';
import { config } from '../config.js';

export const redisClient = createClient({ url: config.redisUrl });

redisClient.on('error', (error) => {
  console.error('Redis error', error);
});

export async function ensureRedisConnected() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}
