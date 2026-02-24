import test from 'node:test';
import assert from 'node:assert/strict';
import { computePowHash, meetsDifficulty, verifyPow } from '../src/pow.js';

test('verifyPow returns true for a valid solution', () => {
  const nonce = 'unit-test-nonce';
  const difficulty = 2;
  let solution = '';
  let found = false;

  for (let i = 0; i < 200000; i += 1) {
    const candidate = `sol-${i}`;
    const hash = computePowHash(nonce, candidate);
    if (meetsDifficulty(hash, difficulty)) {
      solution = candidate;
      found = true;
      break;
    }
  }

  assert.equal(found, true, 'expected to find a valid solution');
  assert.equal(verifyPow(nonce, solution, difficulty), true);
});

test('verifyPow returns false for invalid solutions', () => {
  const nonce = 'unit-test-nonce';
  const difficulty = 3;
  assert.equal(verifyPow(nonce, 'bad-solution', difficulty), false);
});
