import { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { getTreasuryWallet } from '../quai/provider.js';
import { executePayoutForLobby } from '../services/payoutExecutor.js';
import { sanitizeError } from '../logging/sanitize.js';

let payoutExecutionQueue: Promise<unknown> = Promise.resolve();

async function serializePayoutExecution<T>(fn: () => Promise<T>): Promise<T> {
  const next = payoutExecutionQueue.then(fn, fn);
  // Prevent a rejected promise from breaking the chain.
  payoutExecutionQueue = next.catch(() => undefined);
  return next;
}

export async function registerPayoutRoutes(app: FastifyInstance): Promise<void> {
  app.post('/payouts/execute', async (request, reply) => {
    const body = request.body as { lobby_id?: string };

    return await serializePayoutExecution(async () => {
      let lobbyId = (body?.lobby_id ?? '').trim();
      if (!lobbyId) {
        const rows = await query<{ lobby_id: string }>(
          `SELECT lobby_id FROM payouts WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 1`
        );
        lobbyId = rows[0]?.lobby_id ?? '';
      }

      if (!lobbyId) {
        return reply.code(404).send({ error: 'No payout found.' });
      }

      let wallet;
      try {
        wallet = getTreasuryWallet();
      } catch (error: any) {
        request.log.error({ err: sanitizeError(error) }, 'Treasury wallet is not configured');
        return reply.code(500).send({ error: 'Treasury wallet is not configured.' });
      }

      try {
        return await executePayoutForLobby({ lobbyId, query, wallet, log: request.log });
      } catch (error: any) {
        request.log.error({ err: sanitizeError(error), lobbyId }, 'Payout execution failed');
        return reply.code(500).send({ error: 'Payout execution failed.' });
      }
    });
  });
}
