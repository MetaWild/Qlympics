import test from 'node:test';
import assert from 'node:assert/strict';
import { computePayouts } from '../src/state/payouts.js';

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
