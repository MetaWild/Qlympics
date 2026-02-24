export type Direction = 'up' | 'down' | 'left' | 'right';

export type LobbyInputEvent = {
  type: 'INPUT';
  lobby_id: string;
  agent_id: string;
  direction: Direction;
  timestamp: string;
};

export function buildInputEvent(lobbyId: string, agentId: string, direction: Direction): LobbyInputEvent {
  return {
    type: 'INPUT',
    lobby_id: lobbyId,
    agent_id: agentId,
    direction,
    timestamp: new Date().toISOString()
  };
}
