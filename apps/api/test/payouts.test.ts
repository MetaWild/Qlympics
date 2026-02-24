import test from 'node:test';
import assert from 'node:assert/strict';
import { executePayoutForLobby } from '../src/services/payoutExecutor.js';

function fakeWallet() {
  return {
    address: '0x0000000000000000000000000000000000000000',
    // If this ever gets called in these tests, it means we tried to send tx unexpectedly.
    sendTransaction: async () => {
      throw new Error('sendTransaction should not be called in this test');
    }
  } as any;
}

test('executePayoutForLobby does not override FAILED when no pending items remain', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const query = async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    if (text.includes('FROM payouts')) {
      return [{ id: 'p1', lobby_id: 'l1', status: 'FAILED', total_quai: '1' }];
    }
    if (text.includes('FROM payout_items') && text.includes("status = 'PENDING'")) {
      return [];
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const res = await executePayoutForLobby({
    lobbyId: 'l1',
    query: query as any,
    wallet: fakeWallet(),
    log: console as any
  });

  assert.deepEqual(res, { payout_id: 'p1', status: 'FAILED', sent: 0, failed: 0 });
  assert.equal(calls.some((c) => c.text.startsWith('UPDATE payouts')), false);
});

test('executePayoutForLobby does not override SENT when no pending items remain', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const query = async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    if (text.includes('FROM payouts')) {
      return [{ id: 'p1', lobby_id: 'l1', status: 'SENT', total_quai: '1' }];
    }
    if (text.includes('FROM payout_items') && text.includes("status = 'PENDING'")) {
      return [];
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const res = await executePayoutForLobby({
    lobbyId: 'l1',
    query: query as any,
    wallet: fakeWallet(),
    log: console as any
  });

  assert.deepEqual(res, { payout_id: 'p1', status: 'SENT', sent: 0, failed: 0 });
  assert.equal(calls.some((c) => c.text.startsWith('UPDATE payouts')), false);
});

