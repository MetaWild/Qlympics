import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureFreshQuaiUsdPrice } from '../src/services/quaiPriceTicks.js';

test('ensureFreshQuaiUsdPrice samples and inserts when no tick exists', async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];

  const queryFn = async <T,>(sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('FROM quai_price_ticks') && sql.includes('LIMIT 1')) {
      return [] as T[];
    }
    if (sql.includes('INSERT INTO quai_price_ticks')) {
      return [{ price_usd: '2.5', source: 'mexc:QUAIUSDT', sampled_at: new Date().toISOString() }] as unknown as T[];
    }
    throw new Error(`unexpected sql: ${sql}`);
  };

  const fetchFn = async (url: any) => {
    assert.match(String(url), /mexc\.com/);
    return new Response(JSON.stringify({ symbol: 'QUAIUSDT', price: '2.5' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const out = await ensureFreshQuaiUsdPrice(queryFn, { fetchFn, now: new Date('2026-02-05T00:00:00Z') });
  assert.deepEqual(out, { priceUsd: 2.5, source: 'mexc:QUAIUSDT' });

  assert.equal(calls.some((c) => c.sql.includes('FROM quai_price_ticks')), true);
  assert.equal(calls.some((c) => c.sql.includes('INSERT INTO quai_price_ticks')), true);
});

