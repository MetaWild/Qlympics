import React from 'react';
import { api, type Lobby, type LobbyByWatchCode, type LobbyPlayerInfo, type LobbyResult, type LobbyState } from '../api/client';

type ViewPlayer = {
  agentId: string;
  runtimeIdentity: string | null;
  label: string;
  x: number;
  y: number;
  score: number;
  color: string;
};

function stableColor(agentId: string) {
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 85% 55%)`;
}

function shortWallet(addr: string): string {
  const a = (addr ?? '').trim();
  if (!a) return '';
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function formatQuaiWhole(quai: string): string {
  const n = Number(quai);
  if (!Number.isFinite(n)) return `${quai} Quai`;
  return `${Math.round(n)} Quai`;
}

function formatTimeLeftSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function WatchPage(props: { gameModeId: string; watchCode: string; onBack: () => void }) {
  const [resolvedByCode, setResolvedByCode] = React.useState<LobbyByWatchCode | null>(null);
  const [state, setState] = React.useState<LobbyState | null>(null);
  const [result, setResult] = React.useState<LobbyResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lobbies, setLobbies] = React.useState<Lobby[]>([]);
  const [selectedLobbyId, setSelectedLobbyId] = React.useState<string | null>(null);
  const [watchCodeInput, setWatchCodeInput] = React.useState(props.watchCode ?? '');
  const [wsConnected, setWsConnected] = React.useState(false);
  const [hasLiveState, setHasLiveState] = React.useState(false);
  const [playerInfos, setPlayerInfos] = React.useState<LobbyPlayerInfo[] | null>(null);
  const [showLeaderboard, setShowLeaderboard] = React.useState(true);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const fetchedResultRef = React.useRef(false);

  React.useEffect(() => {
    setWatchCodeInput(props.watchCode ?? '');
  }, [props.watchCode]);

  const applyWatchCode = React.useCallback(async () => {
    const raw = (watchCodeInput ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!raw) {
      window.location.hash = `#/watch/${props.gameModeId}`;
      return;
    }
    const code = raw.slice(0, 6);
    if (code.length === 6) {
      try {
        const resolved = await api.getLobbyByWatchCode(code);
        window.location.hash = `#/watch/${resolved.game_mode_id}/${code}`;
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    } else {
      setError('Watch code must be 6 characters.');
    }
  }, [watchCodeInput, props.gameModeId]);

  React.useEffect(() => {
    let stopped = false;
    const code = props.watchCode?.toUpperCase() ?? '';
    if (code.length !== 6) {
      setResolvedByCode(null);
      return;
    }

    void (async () => {
      try {
        const resolved = await api.getLobbyByWatchCode(code);
        if (stopped) return;
        setResolvedByCode(resolved);
        setError(null);
        if (resolved.game_mode_id === props.gameModeId) {
          setSelectedLobbyId(resolved.id);
        } else {
          setError(`Watch code ${code} does not match this game mode.`);
        }
      } catch (e: any) {
        if (stopped) return;
        setResolvedByCode(null);
        setError(String(e?.message ?? e));
      }
    })();

    return () => {
      stopped = true;
    };
  }, [props.watchCode, props.gameModeId]);

  React.useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const all = await api.getLobbies();
        if (stopped) return;
        const filtered = all
          .filter((l) => l.game_mode_id === props.gameModeId)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
        setLobbies(filtered);
        setError(null);

        // If nothing is selected yet, prefer the watch-code resolved lobby, otherwise choose the newest.
        if (!selectedLobbyId) {
          const preferred =
            (resolvedByCode && filtered.find((l) => l.id === resolvedByCode.id)) ??
            (filtered.length ? filtered[0] : null);
          if (preferred) setSelectedLobbyId(preferred.id);
        } else {
          // Selected lobby disappeared (finished/expired); fall back to first available.
          if (filtered.length && !filtered.some((l) => l.id === selectedLobbyId)) {
            // If we are viewing a finished lobby and already have the result, keep it selected
            // so watchers can read the leaderboard before it disappears from the active list.
            if (state?.status === 'FINISHED' && result) {
              return;
            }
            setSelectedLobbyId(filtered[0].id);
          }
        }
      } catch (e: any) {
        if (stopped) return;
        setError(String(e?.message ?? e));
      }
    };

    void poll();
    const id = window.setInterval(poll, 2000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [props.gameModeId, resolvedByCode, selectedLobbyId, state?.status, result]);

  const selectedLobby: Lobby | null = React.useMemo(() => {
    if (!selectedLobbyId) return null;
    return lobbies.find((l) => l.id === selectedLobbyId) ?? null;
  }, [lobbies, selectedLobbyId]);

  React.useEffect(() => {
    fetchedResultRef.current = false;
    setState(null);
    setResult(null);
    setHasLiveState(false);
    setPlayerInfos(null);
  }, [selectedLobbyId]);

  React.useEffect(() => {
    if (!selectedLobbyId) return;
    let stopped = false;

    const load = async () => {
      try {
        const infos = await api.getLobbyPlayers(selectedLobbyId);
        if (stopped) return;
        setPlayerInfos(infos);
      } catch (e: any) {
        if (stopped) return;
        // Lobby may be created but no players yet; ignore.
        const msg = String(e?.message ?? e);
        if (msg.includes('404')) return;
      }
    };

    void load();
    const id = window.setInterval(load, 2000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [selectedLobbyId]);

  React.useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  React.useEffect(() => {
    setWsConnected(false);
    if (!selectedLobbyId) return;

    let stopped = false;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const base = (import.meta as any).env?.VITE_GAME_WS_URL as string | undefined;
    const wsBase = base ?? `${protocol}://${window.location.hostname}:3003`;
    const url = `${wsBase.replace(/\/$/, '')}/ws/lobbies/${encodeURIComponent(selectedLobbyId)}`;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (stopped) return;
      setWsConnected(true);
    };

    ws.onmessage = async (ev) => {
      if (stopped) return;
      try {
        const next = JSON.parse(String(ev.data)) as LobbyState;
        setState(next);
        setHasLiveState(true);
        if (next.status === 'FINISHED' && !fetchedResultRef.current) {
          fetchedResultRef.current = true;
          const res = await api.getLobbyResult(selectedLobbyId);
          if (stopped) return;
          setResult(res);
        }
      } catch {
        // Ignore invalid payloads.
      }
    };

    ws.onerror = () => {
      if (stopped) return;
      setWsConnected(false);
    };

    ws.onclose = () => {
      if (stopped) return;
      setWsConnected(false);
    };

    return () => {
      stopped = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, [selectedLobbyId]);

  React.useEffect(() => {
    if (!selectedLobbyId) return;
    // Keep polling until we have at least one valid state payload. This matters for WAITING lobbies:
    // the WS connection can open before the game server has created the Redis-backed state snapshot.
    if (wsConnected && hasLiveState) return;
    let stopped = false;

    const tick = async () => {
      try {
        const next = await api.getLobbyState(selectedLobbyId);
        if (stopped) return;
        setState(next);
        setHasLiveState(true);

        if (next.status === 'FINISHED' && !fetchedResultRef.current) {
          fetchedResultRef.current = true;
          const res = await api.getLobbyResult(selectedLobbyId);
          if (stopped) return;
          setResult(res);
        }
      } catch (e: any) {
        if (stopped) return;
        const msg = String(e?.message ?? e);
        // In WAITING state the Redis-backed snapshot may not exist yet; treat this as "waiting", not an error.
        if (msg.includes('404') && msg.toLowerCase().includes('state not found')) {
          return;
        }
        setError(msg);
      }
    };

    void tick();
    const id = window.setInterval(tick, 250);

    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [selectedLobbyId, wsConnected, hasLiveState]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = parent.clientWidth;
    const h = parent.clientHeight;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cell = Math.floor(Math.min(w / state.width, h / state.height));
    const gridW = cell * state.width;
    const gridH = cell * state.height;
    const ox = Math.floor((w - gridW) / 2);
    const oy = Math.floor((h - gridH) / 2);

    // background
    ctx.fillStyle = '#0B0B0C';
    ctx.fillRect(0, 0, w, h);

    // subtle scanlines
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#FFFFFF';
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }
    ctx.globalAlpha = 1;

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= state.width; x += 1) {
      const px = ox + x * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, oy);
      ctx.lineTo(px, oy + gridH);
      ctx.stroke();
    }
    for (let y = 0; y <= state.height; y += 1) {
      const py = oy + y * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(ox, py);
      ctx.lineTo(ox + gridW, py);
      ctx.stroke();
    }

    // coins
    for (const coin of state.coins) {
      const cx = ox + coin.x * cell + cell / 2;
      const cy = oy + coin.y * cell + cell / 2;
      ctx.fillStyle = '#F6D44A';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, cell * 0.22), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
    }

    // players
    for (const [agentId, p] of Object.entries(state.players)) {
      const x = ox + p.x * cell;
      const y = oy + p.y * cell;
      ctx.fillStyle = stableColor(agentId);
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
    }
  }, [state]);

  const players: ViewPlayer[] = React.useMemo(() => {
    if (!state) return [];
    const runtimeIdentityByAgent = new Map<string, string>();
    for (const p of playerInfos ?? []) runtimeIdentityByAgent.set(p.agent_id, p.runtime_identity);
    return Object.entries(state.players)
      .map(([agentId, p]) => ({
        agentId,
        runtimeIdentity: runtimeIdentityByAgent.get(agentId) ?? null,
        label: runtimeIdentityByAgent.get(agentId) || agentId.slice(0, 6),
        x: p.x,
        y: p.y,
        score: p.score,
        color: stableColor(agentId)
      }))
      .sort((a, b) => b.score - a.score);
  }, [state, playerInfos]);

  const timeLeftLabel = React.useMemo(() => {
    if (!state) return null;
    const ends = new Date(state.ends_at).getTime();
    if (!Number.isFinite(ends)) return null;
    const sec = (ends - nowMs) / 1000;
    return formatTimeLeftSec(sec);
  }, [state, nowMs]);

  return (
    <div className="screen">
      {error ? <div className="bannerError">{error}</div> : null}

      <div className="watchLayout">
        <aside className="watchLobbies">
          <div className="watchLobbiesHeader">
            <div className="watchLobbiesTitle">Active Lobbies</div>
            <div className="watchControls">
              <input
                className="input inputWatchCode"
                value={watchCodeInput}
                onChange={(e) => setWatchCodeInput(e.target.value)}
                placeholder="Watch code (6 chars)"
                maxLength={12}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyWatchCode();
                }}
              />
              <button className="btn btnTiny btnPrimaryTiny" onClick={applyWatchCode}>
                Watch
              </button>
              <button className="btn btnTiny" onClick={props.onBack}>
                Back
              </button>
            </div>
          </div>
          <div className="watchLobbiesList">
            {lobbies.length === 0 ? <div className="muted">No active lobbies for this game.</div> : null}
            {lobbies.map((l) => (
              <button
                key={l.id}
                className={l.id === selectedLobbyId ? 'lobbyRow lobbyRowActive' : 'lobbyRow'}
                onClick={() => {
                  setSelectedLobbyId(l.id);
                  window.location.hash = `#/watch/${props.gameModeId}/${l.watch_code}`;
                }}
              >
                <div className="lobbyCode">{l.watch_code}</div>
                <div className="lobbyMeta">
                  <div className="lobbyTitle">{l.title ?? 'Coin Runner'}</div>
                  <div className="muted">
                    {l.status}
                    {l.status === 'WAITING' ? ` · ${l.joined_players}/${l.max_players} joined` : ''}
                    {l.status === 'ACTIVE' ? ` · ${l.joined_players}/${l.max_players}` : ''}
                    {` · reward ${l.reward_pool_quai}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="watchMain">
          <div className="watchCanvasWrap">
            <canvas ref={canvasRef} />
            {selectedLobby && !state ? (
              <div className="watchOverlay">
                <div className="watchOverlayTitle">
                  {selectedLobby.status === 'WAITING' ? 'Waiting For Players' : 'Connecting...'}
                </div>
                <div className="muted">
                  {selectedLobby.status === 'WAITING'
                    ? 'This lobby will go live as soon as it fills and the game server starts the match.'
                    : 'Waiting for the game server to publish the first state snapshot.'}
                </div>
                {selectedLobby.status === 'WAITING' ? (
                  <div className="muted mono">
                    {selectedLobby.joined_players}/{selectedLobby.max_players} joined
                  </div>
                ) : null}
              </div>
            ) : null}

            {!showLeaderboard ? (
              <button className="boardToggle" onClick={() => setShowLeaderboard(true)} aria-label="Open leaderboard">
                <span className="boardToggleIcon" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </button>
            ) : null}

            {state?.status === 'FINISHED' && result ? (
              <div className="gameOverOverlay">
                <div className="gameOverTitle">Game Over</div>
                <div className="gameOverSub muted">Final Payouts</div>
                <div className="gameOverList">
                  {result.results.map((r) => (
                    <div key={r.agent_id} className="gameOverRow">
                      <div className="gameOverWallet mono">{shortWallet(r.payout_address)}</div>
                      <div className="gameOverCoins mono">{r.final_coins} coins</div>
                      <div className="gameOverReward mono">{formatQuaiWhole(r.final_reward_quai)}</div>
                    </div>
                  ))}
                </div>
                <div className="gameOverActions">
                  <button className="btn btnPrimary" onClick={props.onBack}>
                    Back Home
                  </button>
                </div>
              </div>
            ) : null}

            <div className="hud hudTopLeft">
              <div className="hudTag">LIVE</div>
              <div className="hudText">
                {selectedLobby ? (
                  <>
                    <span className="badge">{selectedLobby.watch_code}</span>
                    <span className="muted"> · {selectedLobby.status}</span>
                    <span className="muted"> · {wsConnected ? 'WS' : 'POLL'}</span>
                    {timeLeftLabel ? <span className="muted"> · {timeLeftLabel} left</span> : null}
                  </>
                ) : (
                  <span className="muted">Select a lobby to watch.</span>
                )}
              </div>
            </div>

            {showLeaderboard ? (
              <div className="hud hudTopRight hudInteractive">
                <div className="hudTitleRow">
                  <div className="hudTitle">LEADERBOARD</div>
                  <button className="hudCloseBtn" onClick={() => setShowLeaderboard(false)} aria-label="Close leaderboard">
                    X
                  </button>
                </div>
                <div className="hudList hudListScrollable">
                  {players.map((p, idx) => (
                    <div key={p.agentId} className="hudRow">
                      <span className="hudRank mono">{String(idx + 1).padStart(2, '0')}</span>
                      <span className="swatch" style={{ background: p.color }} />
                      <span className="mono hudName">{p.label}</span>
                      <span className="hudScore">{p.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
