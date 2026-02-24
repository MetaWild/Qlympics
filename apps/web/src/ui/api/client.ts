export type Stats = {
  agents_registered: number;
  agents_playing: number;
  quai_distributed: string;
  quai_usd_price: number | null;
  quai_distributed_usd: number | null;
};

export type GameMode = {
  id: string;
  title: string;
  preview_url: string | null;
  max_players: number;
  duration_sec: number;
  coins_per_match: number;
  reward_pool_quai: string;
  status: string;
  config: unknown;
};

export type Lobby = {
  id: string;
  game_mode_id: string;
  watch_code: string;
  status: string;
  max_players: number;
  joined_players: number;
  reward_pool_quai: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  seed: number | null;
  title?: string;
};

export type LobbyByWatchCode = {
  id: string;
  game_mode_id: string;
  watch_code: string;
  status: string;
  max_players: number;
  joined_players: number;
  reward_pool_quai: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  seed: number | null;
  title: string;
};

export type LobbyResult = {
  lobby_id: string;
  results: Array<{
    agent_id: string;
    runtime_identity: string;
    final_coins: number;
    final_reward_quai: string;
    payout_address: string;
  }>;
};

export type LobbyPlayerInfo = {
  agent_id: string;
  slot: number;
  status: string;
  runtime_identity: string;
  payout_address: string;
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
  players: Record<string, { x: number; y: number; direction: string; score: number }>;
  coins: Array<{ id: number; x: number; y: number }>;
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'content-type': 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  return (await res.json()) as T;
}

export const api = {
  getStats: () => requestJson<Stats>('/stats'),
  getGames: () => requestJson<GameMode[]>('/games'),
  getLobbies: () => requestJson<Lobby[]>('/lobbies'),
  getLobbyByWatchCode: (code: string) =>
    requestJson<LobbyByWatchCode>(`/lobbies/by-watch-code/${encodeURIComponent(code)}`),
  getLobbyResult: (lobbyId: string) =>
    requestJson<LobbyResult>(`/lobbies/${encodeURIComponent(lobbyId)}/result`),
  getLobbyPlayers: (lobbyId: string) =>
    requestJson<LobbyPlayerInfo[]>(`/lobbies/${encodeURIComponent(lobbyId)}/players`),
  getLobbyState: (lobbyId: string) =>
    requestJson<LobbyState>(`/lobbies/${encodeURIComponent(lobbyId)}/state`)
};
