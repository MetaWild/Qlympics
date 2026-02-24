import React from 'react';
import type { GameMode } from '../api/client';

export function GameCard(props: {
  game: GameMode;
  onWatchLive: () => void;
  onOnboardAgent: () => void;
}) {
  const { game } = props;
  return (
    <div className="gameCard">
      <div className="gameCardTop">
        <div className="gameTitle">{game.title}</div>
        <div className="gameMeta">
          {game.max_players} players · {game.duration_sec}s · {game.coins_per_match} coins
        </div>
      </div>

      <div className="gamePreview">
        {game.preview_url ? (
          <img className="gamePreviewImg" src={game.preview_url} alt={`${game.title} preview`} />
        ) : (
          <div className="gamePreviewPlaceholder">COIN RUNNER</div>
        )}
      </div>

      <div className="gameActions">
        <button className="btn" onClick={props.onOnboardAgent}>
          Onboard Agent
        </button>
        <button className="btn btnPrimary" onClick={props.onWatchLive}>
          Watch Live
        </button>
      </div>
    </div>
  );
}
