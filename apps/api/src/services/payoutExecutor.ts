import { getAddress, keccak256, parseQuai, type Wallet } from 'quais';
import { config } from '../config.js';
import { reserveTreasuryNonces } from './treasuryNonce.js';
import { redactSecrets, sanitizeError } from '../logging/sanitize.js';

export type PayoutRow = {
  id: string;
  lobby_id: string;
  status: string;
  total_quai: string;
};

export type PayoutItemRow = {
  id: string;
  payout_id: string;
  agent_id: string;
  payout_address: string;
  amount_quai: string;
  status: string;
};

export type DbQuery = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<T[]>;

export type PayoutLog = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export async function executePayoutForLobby(opts: {
  lobbyId: string;
  query: DbQuery;
  wallet: Wallet;
  log: PayoutLog;
}): Promise<{ payout_id: string; status: 'SENT' | 'FAILED'; sent: number; failed: number }> {
  const { lobbyId, query, wallet, log } = opts;
  const payouts = await query<PayoutRow>(`SELECT id, lobby_id, status, total_quai FROM payouts WHERE lobby_id = $1`, [
    lobbyId
  ]);

  const payout = payouts[0];
  if (!payout) {
    throw new Error(`No payout found for lobby ${lobbyId}`);
  }

  const fromAddress = getAddress(wallet.address);

  if (String(payout.total_quai) === '0') {
    await query(`UPDATE payouts SET status = 'SENT' WHERE id = $1`, [payout.id]);
    return { payout_id: payout.id, status: 'SENT', sent: 0, failed: 0 };
  }

  // Idempotency: do not override a terminal payout status on retries.
  // If there are no pending items left, treat this as a no-op.
  const existingStatus = String(payout.status || '').toUpperCase();
  if (existingStatus === 'SENT' || existingStatus === 'FAILED') {
    const pending = await query<PayoutItemRow>(
      `SELECT id, payout_id, agent_id, payout_address, amount_quai, status
       FROM payout_items
       WHERE payout_id = $1 AND status = 'PENDING'`,
      [payout.id]
    );
    if (!pending.length) {
      return { payout_id: payout.id, status: existingStatus as 'SENT' | 'FAILED', sent: 0, failed: 0 };
    }
  }

  const items = await query<PayoutItemRow>(
    `SELECT id, payout_id, agent_id, payout_address, amount_quai, status
     FROM payout_items
     WHERE payout_id = $1 AND status = 'PENDING'`,
    [payout.id]
  );

  if (!items.length) {
    await query(`UPDATE payouts SET status = 'SENT' WHERE id = $1`, [payout.id]);
    return { payout_id: payout.id, status: 'SENT', sent: 0, failed: 0 };
  }

  const provider: any = (wallet as any).provider;
  if (!provider || typeof provider.send !== 'function') {
    throw new Error('Treasury wallet provider is not configured');
  }

  const rpcTimeoutMs = Number(process.env.PAYOUT_RPC_TIMEOUT_MS ?? '30000');
  const minGasLimit = BigInt(process.env.PAYOUT_GAS_LIMIT ?? '60000');
  const fallbackGasPrice = BigInt(process.env.PAYOUT_GAS_PRICE_WEI ?? '1200000000');
  const sendRetries = Math.max(1, Number(process.env.PAYOUT_SEND_RETRIES ?? '4'));
  const sendBackoffMs = Math.max(0, Number(process.env.PAYOUT_SEND_BACKOFF_MS ?? '500'));

  const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${rpcTimeoutMs}ms`)), rpcTimeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const isRetryableSendError = (msg: string) => {
    const m = msg.toLowerCase();
    return (
      m.includes('timed out') ||
      m.includes('timeout') ||
      m.includes('econnreset') ||
      m.includes('socket hang up') ||
      m.includes('fetch failed') ||
      m.includes('temporarily unavailable') ||
      m.includes('too many requests') ||
      m.includes('429') ||
      m.includes('503') ||
      m.includes('gateway') ||
      m.includes('rate limit')
    );
  };

  const isInsufficientFunds = (msg: string) => msg.toLowerCase().includes('insufficient funds');

  const providerTry = async (method: string, params: unknown[]) => {
    try {
      return await withTimeout(provider.send(method, params), method);
    } catch {
      return null;
    }
  };

  const getTxOrReceipt = async (txHash: string) => {
    // Different RPCs may expose either eth_* or quai_* names.
    const tx =
      (await providerTry('eth_getTransactionByHash', [txHash])) ?? (await providerTry('quai_getTransactionByHash', [txHash]));
    if (tx) return tx;
    const receipt =
      (await providerTry('eth_getTransactionReceipt', [txHash])) ??
      (await providerTry('quai_getTransactionReceipt', [txHash]));
    return receipt;
  };

  let sentCount = 0;
  let failedCount = 0;

  // Reserve a contiguous nonce range so every tx uses a unique nonce even under concurrency
  // (multiple API instances / workers). This avoids "already known" / "replacement fee too low"
  // failures caused by duplicate nonces.
  const startNonce = await reserveTreasuryNonces({
    fromAddress,
    chainId: config.quaiChainId,
    count: items.length,
    provider
  });
  let nextNonce = startNonce;

  let gasPrice = fallbackGasPrice;
  try {
    const gp = await withTimeout(provider.send('eth_gasPrice', []), 'eth_gasPrice');
    if (typeof gp === 'string' && gp.startsWith('0x')) gasPrice = BigInt(gp);
  } catch {
    // fallback
  }

  for (const item of items) {
    try {
      const value = parseQuai(item.amount_quai);
      const toAddress = getAddress(item.payout_address);
      let nonce = nextNonce;
      nextNonce += 1n;

      const tx = {
        type: 0 as const,
        chainId: config.quaiChainId,
        from: fromAddress,
        to: toAddress,
        value,
        nonce: Number(nonce),
        gasLimit: minGasLimit,
        gasPrice
      };

      let signed = String(await withTimeout((wallet as any).signTransaction(tx), 'signTransaction'));
      let computedHash = keccak256(signed);

      let txHash = '';
      for (let attempt = 1; attempt <= sendRetries; attempt += 1) {
        try {
          const sent = await withTimeout(provider.send('eth_sendRawTransaction', [signed]), 'eth_sendRawTransaction');
          txHash = String(sent ?? '').trim();
          break;
        } catch (error: any) {
          const msg = String(error?.message ?? error);

          // If the node already has this tx, treat it as sent.
          if (msg.includes('already known') || msg.includes('transaction already known')) {
            txHash = computedHash;
            break;
          }

          // If the tx may have been accepted but we didn't get a response, check by hash.
          const existing = await getTxOrReceipt(computedHash);
          if (existing) {
            txHash = computedHash;
            break;
          }

          if (isInsufficientFunds(msg)) {
            throw error;
          }

          // If our nonce is stale (external tx from treasury, or a prior run still pending), re-reserve a fresh nonce
          // and retry signing/sending once. This is safe because we only mark SENT once we have a hash.
          if (msg.toLowerCase().includes('nonce too low') && attempt === 1) {
            const freshStart = await reserveTreasuryNonces({
              fromAddress,
              chainId: config.quaiChainId,
              count: 1,
              provider
            });
            nonce = freshStart;
            (tx as any).nonce = Number(nonce);
            signed = String(await withTimeout((wallet as any).signTransaction(tx), 'signTransaction'));
            computedHash = keccak256(signed);
            continue;
          }

          if (!isRetryableSendError(msg) || attempt >= sendRetries) {
            throw error;
          }

          await sleep(sendBackoffMs * attempt);
        }
      }

      if (!txHash || !txHash.startsWith('0x')) txHash = computedHash;

      await query(`UPDATE payout_items SET status = 'SENT', tx_hash = $1, attempted_at = now() WHERE id = $2`, [
        txHash,
        item.id
      ]);
      sentCount += 1;
    } catch (error: any) {
      log.error(
        { err: sanitizeError(error), payoutItemId: item.id, payoutAddress: item.payout_address },
        'Failed to send payout tx'
      );
      await query(`UPDATE payout_items SET status = 'FAILED', error = $1, attempted_at = now() WHERE id = $2`, [
        redactSecrets(String(error?.message ?? error)),
        item.id
      ]);
      failedCount += 1;
    }
  }

  const newStatus: 'SENT' | 'FAILED' = sentCount > 0 ? 'SENT' : 'FAILED';
  const error = sentCount > 0 ? null : 'All payouts failed';

  await query(`UPDATE payouts SET status = $1, from_wallet = $2, error = $3 WHERE id = $4`, [
    newStatus,
    fromAddress,
    error,
    payout.id
  ]);

  if (sentCount === 0) {
    log.warn({ payoutId: payout.id, lobbyId, fromAddress, failedCount }, 'Payout execution sent 0 transactions');
  } else {
    log.info({ payoutId: payout.id, lobbyId, fromAddress, sentCount, failedCount }, 'Payout execution complete');
  }

  return { payout_id: payout.id, status: newStatus, sent: sentCount, failed: failedCount };
}
