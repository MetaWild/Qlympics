import React from 'react';
import { api, type GameMode } from '../api/client';
import { GameCard } from '../components/GameCard';

function useInterval(callback: () => void, delayMs: number) {
  React.useEffect(() => {
    const id = window.setInterval(callback, delayMs);
    return () => window.clearInterval(id);
  }, [callback, delayMs]);
}

export function HomePage(props: { onWatchLive: (gameModeId: string) => void; onOnboard: () => void }) {
  const [games, setGames] = React.useState<GameMode[] | null>(null);
  const [lobbies, setLobbies] = React.useState<Array<{ id: string; game_mode_id: string; created_at: string }> | null>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const g = await api.getGames();
      setGames(g);
      const l = await api.getLobbies();
      setLobbies(l);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  useInterval(load, 5000);

  const coinGames = (games ?? []).filter((g) => g.title.toLowerCase().includes('coin'));

  // If there is an active lobby, prefer the game mode that actually has live activity
  // so Watch Live reliably shows something during demos.
  const newestCoinLobbyGameModeId = React.useMemo(() => {
    const lobbyRows = lobbies ?? [];
    if (!coinGames.length || !lobbyRows.length) return null;
    const coinGameIds = new Set(coinGames.map((g) => g.id));
    const newest = lobbyRows
      .filter((l) => coinGameIds.has(l.game_mode_id))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))[0];
    return newest?.game_mode_id ?? null;
  }, [lobbies, coinGames]);

  const selectedGame =
    (newestCoinLobbyGameModeId ? (games ?? []).find((g) => g.id === newestCoinLobbyGameModeId) : null) ??
    coinGames[0] ??
    (games?.[0] ?? null);

  return (
    <div className="screen">
      {error ? <div className="bannerError">{error}</div> : null}

      <div className="grid gridSingle">
        {selectedGame ? (
          <GameCard
            game={selectedGame}
            onWatchLive={() => props.onWatchLive(selectedGame.id)}
            onOnboardAgent={props.onOnboard}
          />
        ) : (
          <div className="panel">Loading games...</div>
        )}
      </div>
    </div>
  );
}
