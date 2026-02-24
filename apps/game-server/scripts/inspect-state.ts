import { createClient } from 'redis';
import { config } from '../src/config.js';

async function main() {
  const lobbyId = process.argv[2];
  if (!lobbyId) {
    console.error('Usage: npm run inspect -- <lobbyId>');
    process.exit(1);
  }

  const client = createClient({ url: config.redisUrl });
  client.on('error', (error) => console.error('Redis error', error));
  await client.connect();

  const state = await client.get(`lobby:${lobbyId}:state`);
  const seq = await client.get(`lobby:${lobbyId}:seq`);

  console.log('state', state ? JSON.parse(state) : null);
  console.log('seq', seq);

  await client.disconnect();
}

main().catch((error) => {
  console.error('Inspect failed', error);
  process.exit(1);
});
