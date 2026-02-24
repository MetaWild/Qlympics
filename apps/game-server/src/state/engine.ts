import { LobbyConfig, LobbyInputEvent, LobbyState } from './types.js';
import { nextRandom } from './rng.js';

function coordKey(x: number, y: number): string {
  return `${x},${y}`;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function computeTarget(x: number, y: number, direction: string) {
  switch (direction) {
    case 'up':
      return { x, y: y - 1 };
    case 'down':
      return { x, y: y + 1 };
    case 'left':
      return { x: x - 1, y };
    case 'right':
      return { x: x + 1, y };
    default:
      return { x, y };
  }
}

function pickEmptyCell(
  width: number,
  height: number,
  occupied: Set<string>,
  rngState: number,
  maxAttempts = 200
): { x: number; y: number; rngState: number } | null {
  let state = rngState;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let rand;
    [rand, state] = nextRandom(state);
    const x = Math.floor(rand * width);
    [rand, state] = nextRandom(state);
    const y = Math.floor(rand * height);
    const key = coordKey(x, y);
    if (!occupied.has(key)) {
      return { x, y, rngState: state };
    }
  }
  return null;
}

export function initLobbyState(config: LobbyConfig, agentIds: string[]): LobbyState {
  const startedAt = new Date(config.started_at);
  const endsAt = new Date(startedAt.getTime() + config.duration_sec * 1000);
  const players: LobbyState['players'] = {};
  const occupied = new Set<string>();

  let rngState = config.seed >>> 0;

  for (const agentId of agentIds) {
    const cell = pickEmptyCell(config.width, config.height, occupied, rngState);
    if (!cell) {
      break;
    }
    rngState = cell.rngState;
    occupied.add(coordKey(cell.x, cell.y));
    players[agentId] = {
      x: cell.x,
      y: cell.y,
      direction: 'up',
      score: 0
    };
  }

  return {
    lobby_id: config.lobby_id,
    status: 'ACTIVE',
    tick: 0,
    tick_rate: config.tick_rate,
    width: config.width,
    height: config.height,
    started_at: config.started_at,
    ends_at: endsAt.toISOString(),
    updated_at: new Date().toISOString(),
    players,
    coins: [],
    coins_spawned: 0,
    next_coin_id: 1,
    spawn_accumulator: 1,
    rng_state: rngState
  };
}

export function stepLobbyState(
  state: LobbyState,
  config: LobbyConfig,
  inputs: LobbyInputEvent[],
  now: Date
): LobbyState {
  const next: LobbyState = {
    ...state,
    players: { ...state.players },
    coins: [...state.coins]
  };

  next.tick += 1;
  next.updated_at = now.toISOString();

  const occupied = new Set<string>();
  for (const [agentId, player] of Object.entries(next.players)) {
    occupied.add(coordKey(player.x, player.y));
    next.players[agentId] = { ...player };
  }

  const moved = new Set<string>();
  for (const event of inputs) {
    if (event.type !== 'INPUT') {
      continue;
    }
    if (moved.has(event.agent_id)) {
      continue;
    }
    const player = next.players[event.agent_id];
    if (!player) {
      continue;
    }
    const target = computeTarget(player.x, player.y, event.direction);
    const clampedX = clamp(target.x, 0, next.width - 1);
    const clampedY = clamp(target.y, 0, next.height - 1);
    const targetKey = coordKey(clampedX, clampedY);

    if (occupied.has(targetKey)) {
      moved.add(event.agent_id);
      continue;
    }

    occupied.delete(coordKey(player.x, player.y));
    player.x = clampedX;
    player.y = clampedY;
    player.direction = event.direction;
    occupied.add(targetKey);
    moved.add(event.agent_id);
  }

  const playerByPos = new Map<string, string>();
  for (const [agentId, player] of Object.entries(next.players)) {
    playerByPos.set(coordKey(player.x, player.y), agentId);
  }

  const remainingCoins: LobbyState['coins'] = [];
  for (const coin of next.coins) {
    const owner = playerByPos.get(coordKey(coin.x, coin.y));
    if (owner) {
      next.players[owner].score += 1;
    } else {
      remainingCoins.push(coin);
    }
  }
  next.coins = remainingCoins;

  const spawnRate = config.coins_per_match / config.duration_sec;
  next.spawn_accumulator += spawnRate / config.tick_rate;

  while (next.spawn_accumulator >= 1 && next.coins_spawned < config.coins_per_match) {
    const occupiedPositions = new Set<string>();
    for (const key of playerByPos.keys()) {
      occupiedPositions.add(key);
    }
    for (const coin of next.coins) {
      occupiedPositions.add(coordKey(coin.x, coin.y));
    }

    const cell = pickEmptyCell(next.width, next.height, occupiedPositions, next.rng_state);
    if (!cell) {
      break;
    }

    next.rng_state = cell.rngState;
    next.coins.push({ id: next.next_coin_id, x: cell.x, y: cell.y });
    next.next_coin_id += 1;
    next.coins_spawned += 1;
    next.spawn_accumulator -= 1;
  }

  if (now.getTime() >= new Date(next.ends_at).getTime()) {
    next.status = 'FINISHED';
  }

  return next;
}
