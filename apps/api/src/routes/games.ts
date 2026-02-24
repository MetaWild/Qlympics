import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

type GameModeRow = {
  id: string;
  title: string;
  preview_url: string | null;
  max_players: number;
  duration_sec: number;
  coins_per_match: number;
  reward_pool_quai: string;
  status: string;
  config: Record<string, unknown>;
};

export async function registerGameRoutes(app: FastifyInstance): Promise<void> {
  app.get('/games', async () => {
    const rows = await query<GameModeRow>(
      `
      SELECT id, title, preview_url, max_players, duration_sec, coins_per_match, reward_pool_quai, status, config
      FROM game_modes
      WHERE status = 'ACTIVE'
      ORDER BY title ASC
      `
    );
    return rows;
  });
}
