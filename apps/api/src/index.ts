import { buildServer } from './server.js';
import { config } from './config.js';
import { startAutoPayoutWorker } from './workers/autoPayouts.js';
import { getQuaiProviderDebugInfo } from './quai/provider.js';
import { getAddress } from 'quais';
import { getTreasuryWallet } from './quai/provider.js';

const app = buildServer();

app.listen({ port: config.port, host: '0.0.0.0' })
  .then((address) => {
    app.log.info(`API listening at ${address}`);
    const quai = getQuaiProviderDebugInfo();
    app.log.info(
      { quaiRpcUrl: quai.rpcUrl, quaiChainId: config.quaiChainId, quaiUsePathing: quai.usePathing },
      'Quai RPC config'
    );
    try {
      const w = getTreasuryWallet();
      app.log.info({ treasuryFrom: getAddress(w.address) }, 'Treasury wallet loaded');
    } catch (error: any) {
      app.log.warn({ err: error }, 'Treasury wallet not configured');
    }
    // Best-effort background worker (does not crash the API if it fails to start).
    startAutoPayoutWorker(app.log).catch((error) => {
      app.log.error({ err: error }, 'Auto payout worker failed to start');
    });
  })
  .catch((error) => {
    app.log.error(error, 'Failed to start server');
    process.exit(1);
  });
