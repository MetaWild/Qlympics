import test from 'node:test';
import assert from 'node:assert/strict';
import { stepLobbyState } from '../src/state/engine.js';
import { LobbyConfig, LobbyInputEvent, LobbyState } from '../src/state/types.js';

function baseConfig(): LobbyConfig {
  return {
    lobby_id: 'lobby-1',
    width: 5,
    height: 5,
    tick_rate: 10,
    duration_sec: 30,
    coins_per_match: 10,
    reward_pool_quai: '10.0',
    seed: 1,
    started_at: new Date().toISOString()
  };
}

function baseState(): LobbyState {
  const started = new Date();
  const ends = new Date(started.getTime() + 30_000);
  return {
    lobby_id: 'lobby-1',
    status: 'ACTIVE',
    tick: 0,
    tick_rate: 10,
    width: 5,
    height: 5,
    started_at: started.toISOString(),
    ends_at: ends.toISOString(),
    updated_at: started.toISOString(),
    players: {
      a: { x: 1, y: 1, direction: 'up', score: 0 },
      b: { x: 3, y: 1, direction: 'up', score: 0 }
    },
    coins: [],
    coins_spawned: 0,
    next_coin_id: 1,
    spawn_accumulator: 1,
    rng_state: 1
  };
}

test('first input wins collision on same tile', () => {
  const config = baseConfig();
  const state = baseState();
  const inputs: LobbyInputEvent[] = [
    { type: 'INPUT', lobby_id: 'lobby-1', agent_id: 'a', direction: 'right', timestamp: new Date().toISOString() },
    { type: 'INPUT', lobby_id: 'lobby-1', agent_id: 'b', direction: 'left', timestamp: new Date().toISOString() }
  ];

  const next = stepLobbyState(state, config, inputs, new Date());
  assert.equal(next.players.a.x, 2);
  assert.equal(next.players.b.x, 3);
});

test('only first input per agent per tick is applied', () => {
  const config = baseConfig();
  const state = baseState();
  const inputs: LobbyInputEvent[] = [
    { type: 'INPUT', lobby_id: 'lobby-1', agent_id: 'a', direction: 'up', timestamp: new Date().toISOString() },
    { type: 'INPUT', lobby_id: 'lobby-1', agent_id: 'a', direction: 'right', timestamp: new Date().toISOString() }
  ];

  const next = stepLobbyState(state, config, inputs, new Date());
  assert.equal(next.players.a.y, 0);
  assert.equal(next.players.a.x, 1);
});

test('coins do not spawn on player tiles', () => {
  const config = { ...baseConfig(), coins_per_match: 1, duration_sec: 1 };
  const state = baseState();

  const next = stepLobbyState(state, config, [], new Date());
  assert.equal(next.coins.length, 1);
  const coin = next.coins[0];
  const occupied = new Set([`${next.players.a.x},${next.players.a.y}`, `${next.players.b.x},${next.players.b.y}`]);
  assert.equal(occupied.has(`${coin.x},${coin.y}`), false);
});
