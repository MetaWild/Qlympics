export type Direction = 'up' | 'down' | 'left' | 'right';

export type LobbyInputEvent = {
  type: 'INPUT';
  lobby_id: string;
  agent_id: string;
  direction: Direction;
  timestamp: string;
};

export type LobbyConfig = {
  lobby_id: string;
  width: number;
  height: number;
  tick_rate: number;
  duration_sec: number;
  coins_per_match: number;
  reward_pool_quai: string;
  seed: number;
  started_at: string;
};

export type PlayerState = {
  x: number;
  y: number;
  direction: Direction;
  score: number;
};

export type CoinState = {
  id: number;
  x: number;
  y: number;
};

export type LobbyState = {
  lobby_id: string;
  status: 'ACTIVE' | 'FINISHED';
  tick: number;
  tick_rate: number;
  width: number;
  height: number;
  started_at: string;
  ends_at: string;
  updated_at: string;
  players: Record<string, PlayerState>;
  coins: CoinState[];
  coins_spawned: number;
  next_coin_id: number;
  spawn_accumulator: number;
  rng_state: number;
};
