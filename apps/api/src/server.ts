import Fastify from 'fastify';
import { registerHealthRoutes } from './routes/health.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerGameRoutes } from './routes/games.js';
import { registerLobbyRoutes } from './routes/lobbies.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerPayoutRoutes } from './routes/payouts.js';

export function buildServer() {
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.x-api-key',
          'req.headers.cookie',
          'headers.authorization',
          'headers.x-api-key',
          'headers.cookie',
          'authorization',
          'x-api-key',
          'cookie'
        ],
        censor: '[REDACTED]'
      }
    }
  });

  app.register(registerHealthRoutes);
  app.register(registerStatsRoutes);
  app.register(registerGameRoutes);
  app.register(registerLobbyRoutes);
  app.register(registerAgentRoutes);
  app.register(registerPayoutRoutes);

  return app;
}
