import test from 'node:test';
import assert from 'node:assert/strict';
import { computePayouts, parseDecimalToBigInt } from '../src/state/payouts.js';

test('computePayouts distributes fixed value per coin (uncollected coins not distributed)', () => {
  // rewardPool=10, coinsPerMatch=10 => 1 coin == 1 Quai
  const { totalQuai, breakdown } = computePayouts('10.0', 10, { a: 3, b: 1 });
  assert.equal(totalQuai, '4');
  assert.equal(breakdown.a, '3');
  assert.equal(breakdown.b, '1');
});

test('computePayouts returns empty when no coins', () => {
  const { totalQuai, breakdown } = computePayouts('10.0', 10, { a: 0, b: 0 });
  assert.equal(totalQuai, '0');
  assert.equal(Object.keys(breakdown).length, 0);
});

test('computePayouts with production values (50 pool, 50 coins, partial collection)', () => {
  // 5 agents, only 20 of 50 coins collected => 20 Quai distributed, 30 Quai retained
  const { totalQuai, breakdown } = computePayouts('50', 50, { a: 8, b: 5, c: 4, d: 2, e: 1 });
  assert.equal(totalQuai, '20');
  assert.equal(breakdown.a, '8');
  assert.equal(breakdown.b, '5');
  assert.equal(breakdown.c, '4');
  assert.equal(breakdown.d, '2');
  assert.equal(breakdown.e, '1');
});

test('computePayouts with production values (all coins collected)', () => {
  const { totalQuai, breakdown } = computePayouts('50', 50, { a: 15, b: 12, c: 10, d: 8, e: 5 });
  assert.equal(totalQuai, '50');
  assert.equal(breakdown.a, '15');
});

test('computePayouts never exceeds reward pool', () => {
  // Safety: even if scores somehow exceed coins_per_match, payout must be capped
  const { totalQuai } = computePayouts('50', 50, { a: 30, b: 25 });
  const totalWei = parseDecimalToBigInt(totalQuai, 18);
  const poolWei = parseDecimalToBigInt('50', 18);
  assert.ok(totalWei <= poolWei, `Total payout ${totalQuai} exceeds pool 50`);
});

test('computePayouts single agent partial collection', () => {
  const { totalQuai, breakdown } = computePayouts('50', 50, { a: 1 });
  assert.equal(totalQuai, '1');
  assert.equal(breakdown.a, '1');
});
