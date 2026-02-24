import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInputEvent } from '../src/events/input.js';

test('buildInputEvent creates a valid payload', () => {
  const event = buildInputEvent('lobby-1', 'agent-1', 'up');
  assert.equal(event.type, 'INPUT');
  assert.equal(event.lobby_id, 'lobby-1');
  assert.equal(event.agent_id, 'agent-1');
  assert.equal(event.direction, 'up');
  assert.equal(typeof event.timestamp, 'string');
});
