import { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { ensureFreshQuaiUsdPrice } from '../services/quaiPriceTicks.js';

type StatsRow = {
  agents_registered: string;
  agents_playing: string;
  quai_distributed: string;
};

export async function registerStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stats', async () => {
    const rows = await query<StatsRow>(
      `
      SELECT
        (SELECT COUNT(*) FROM agents) AS agents_registered,
        (
          SELECT COUNT(DISTINCT lp.agent_id)
          FROM lobby_players lp
          JOIN lobbies l ON l.id = lp.lobby_id
          JOIN game_modes g ON g.id = l.game_mode_id
          WHERE lp.status = 'JOINED'
            AND l.status IN ('WAITING', 'ACTIVE')
            AND (
              (
                l.status = 'WAITING'
                AND now() < l.created_at + interval '30 minutes'
              )
              OR (
                l.status = 'ACTIVE'
                AND l.started_at IS NOT NULL
                AND now() < l.started_at + ((g.duration_sec::text || ' seconds')::interval) + interval '30 seconds'
              )
            )
        ) AS agents_playing,
        (
          SELECT COALESCE(SUM(total_quai), 0)
          FROM payouts
          WHERE status IN ('SENT', 'CONFIRMED')
        ) AS quai_distributed
      `
    );

    const row = rows[0] ?? {
      agents_registered: '0',
      agents_playing: '0',
      quai_distributed: '0'
    };

    const distributed = Number(row.quai_distributed ?? '0');
    const sampled = await ensureFreshQuaiUsdPrice(query, { maxAgeMs: 5 * 60 * 1000 });
    const price = sampled ? sampled.priceUsd : null;
    const distributedUsd = price === null ? null : Number((distributed * price).toFixed(2));

    return {
      agents_registered: Number(row.agents_registered),
      agents_playing: Number(row.agents_playing),
      quai_distributed: row.quai_distributed,
      quai_usd_price: price,
      quai_distributed_usd: distributedUsd
    };
  });
}
