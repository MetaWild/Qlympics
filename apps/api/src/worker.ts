import { startAutoPayoutWorker } from './workers/autoPayouts.js';
import { sanitizeError } from './logging/sanitize.js';

type LogMethod = (obj: unknown, msg?: string) => void;

function logWith(level: 'info' | 'warn' | 'error'): LogMethod {
  return (obj: unknown, msg?: string) => {
    const prefix = `[auto-payout-worker] ${level.toUpperCase()}`;
    if (msg) {
      // eslint-disable-next-line no-console
      console[level](prefix, msg, obj);
      return;
    }
    // eslint-disable-next-line no-console
    console[level](prefix, obj);
  };
}

async function main() {
  const log = {
    info: logWith('info'),
    warn: logWith('warn'),
    error: logWith('error')
  };

  await startAutoPayoutWorker(log);

  // Keep process alive (worker listens via Redis subscriptions).
  setInterval(() => {
    // no-op
  }, 60_000).unref();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[auto-payout-worker] Fatal startup error', sanitizeError(error));
  process.exit(1);
});
