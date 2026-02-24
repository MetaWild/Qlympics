import { ensureRedisConnected, redisClient } from '../redis/client.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { getTreasuryWallet } from '../quai/provider.js';
import { executePayoutForLobby } from '../services/payoutExecutor.js';

type LogLike = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

const CHANNEL = 'pubsub:payouts';

function parseLobbyId(message: string): string | null {
  try {
    const payload = JSON.parse(message) as { lobby_id?: string; lobbyId?: string };
    const lobbyId = String(payload.lobby_id ?? payload.lobbyId ?? '').trim();
    return lobbyId.length ? lobbyId : null;
  } catch {
    return null;
  }
}

export async function startAutoPayoutWorker(log: LogLike): Promise<void> {
  // Opt-in only: running this in dev/test can spend real (testnet/mainnet) funds.
  const enabled = (process.env.AUTO_PAYOUTS_ENABLED ?? '0') === '1';
  if (!enabled) {
    log.info({ channel: CHANNEL }, 'Auto payouts disabled (AUTO_PAYOUTS_ENABLED=0)');
    return;
  }
  if (!config.quaiTreasuryPrivateKey) {
    log.warn({ channel: CHANNEL }, 'Auto payouts disabled (QUAI_TREASURY_PRIVATE_KEY not set)');
    return;
  }

  await ensureRedisConnected();
  const sub = redisClient.duplicate();
  await sub.connect();

  const queue: string[] = [];
  const enqueued = new Set<string>();
  const concurrency = Math.max(1, Number(process.env.AUTO_PAYOUT_CONCURRENCY ?? '1') || 1);
  let inFlight = 0;

  const schedule = () => {
    while (inFlight < concurrency && queue.length > 0) {
      const lobbyId = queue.shift();
      if (!lobbyId) return;
      enqueued.delete(lobbyId);
      inFlight += 1;

      (async () => {
        try {
          const wallet = getTreasuryWallet();
          const res = await executePayoutForLobby({ lobbyId, query, wallet, log });
          log.info({ lobbyId, ...res }, 'Auto payout executed');
        } catch (error: any) {
          log.error({ err: error, lobbyId }, 'Auto payout failed');
        } finally {
          inFlight -= 1;
          // Process the next lobby soon, but don't starve the event loop.
          setTimeout(schedule, 10);
        }
      })().catch(() => {
        // best-effort
      });
    }
  };

  await sub.subscribe(CHANNEL, (message) => {
    const lobbyId = parseLobbyId(message);
    if (!lobbyId) {
      log.warn({ message }, 'Auto payout received invalid message');
      return;
    }
    if (enqueued.has(lobbyId)) return;
    enqueued.add(lobbyId);
    queue.push(lobbyId);
    schedule();
  });

  log.info({ channel: CHANNEL, concurrency }, 'Auto payout worker started');
}
