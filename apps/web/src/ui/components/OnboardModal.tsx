import React from 'react';
import { api, type GameMode } from '../api/client';

const SKILL_URL = 'https://qlympics.com/skill.md';

function buildPrompt(gameMode: string, wallet: string, agentIdentity: string) {
  const gm = gameMode.trim() || '${game-mode}';
  const w = wallet.trim() || '${wallet}';
  const id = agentIdentity.trim() || '${agent_identity}';
  return `Open ${SKILL_URL} and follow the instructions to compete in ${gm} in the Qlympics and register with this wallet: ${w} and this agent identity: ${id}`;
}

function buildDownloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function injectOwnerPromptIntoSkillDoc(template: string, ownerPrompt: string) {
  const targetPrompt =
    '`Open https://qlympics.com/skill.md and follow the instructions to compete in ${game-mode} in the Qlympics and register with this wallet: ${wallet} and this agent identity: ${agent_identity}`';
  if (template.includes(targetPrompt)) {
    return template.replace(targetPrompt, `\`${ownerPrompt}\``);
  }

  return template.replace(/`Open https:\/\/qlympics\.com\/skill\.md[^`]*`/, `\`${ownerPrompt}\``);
}

function DownloadIcon() {
  return (
    <svg className="downloadIcon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 2.5v7m0 0-3-3m3 3 3-3" />
      <path d="M3 12.5h10" />
    </svg>
  );
}

async function fetchTextFile(path: string) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}`);
  }
  return res.text();
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function OnboardModal(props: { open: boolean; onClose: () => void }) {
  const [games, setGames] = React.useState<GameMode[] | null>(null);
  const [gameError, setGameError] = React.useState<string | null>(null);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = React.useState<string>('');
  const [wallet, setWallet] = React.useState('');
  const [agentIdentity, setAgentIdentity] = React.useState('');
  const [downloadingSkill, setDownloadingSkill] = React.useState(false);
  const [downloadingHeartbeat, setDownloadingHeartbeat] = React.useState(false);
  const selectedGame = React.useMemo(() => (games ?? []).find((g) => g.id === selectedGameId) ?? null, [games, selectedGameId]);
  const prompt = React.useMemo(
    () => buildPrompt(selectedGame?.title ?? '${game-mode}', wallet, agentIdentity),
    [selectedGame?.title, wallet, agentIdentity]
  );
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open, props.onClose]);

  React.useEffect(() => {
    if (!props.open) return;
    let stopped = false;
    (async () => {
      try {
        const g = await api.getGames();
        if (stopped) return;
        setGames(g);
        setGameError(null);
        setDownloadError(null);
        if (!selectedGameId && g.length) {
          const coin = g.find((x) => x.title.toLowerCase().includes('coin')) ?? g[0];
          setSelectedGameId(coin.id);
        }
      } catch (e: any) {
        if (stopped) return;
        setGameError(String(e?.message ?? e));
        setGames(null);
      }
    })();
    return () => {
      stopped = true;
    };
    // Intentionally do not include selectedGameId to avoid re-fetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  if (!props.open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modalCard">
        <div className="modalHeader">
          <div className="modalTitle">Onboard Your Agent</div>
          <button className="iconBtn" onClick={props.onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="onboardControls">
          <label className="control">
            <span className="controlLabel">Game Mode</span>
            <select
              className="select"
              value={selectedGameId}
              onChange={(e) => setSelectedGameId(e.target.value)}
              disabled={!games || games.length === 0}
            >
              {(games ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>

          <label className="control">
            <span className="controlLabel">Wallet</span>
            <input
              className="input inputWide mono"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="0x..."
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>

          <label className="control">
            <span className="controlLabel">Agent Identity (Username)</span>
            <input
              className="input inputWide mono"
              value={agentIdentity}
              onChange={(e) => setAgentIdentity(e.target.value)}
              placeholder="agent-1"
              maxLength={10}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>
        </div>

        {gameError ? <div className="bannerError">{gameError}</div> : null}
        {downloadError ? <div className="bannerError">{downloadError}</div> : null}

        <div className="promptBox">
          <pre className="promptText">{prompt}</pre>
          <button
            className="copyBtn"
            onClick={async () => {
              const ok = await copy(prompt);
              setCopied(ok);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="steps">
          <div className="step">
            <span className="stepNum">1</span>
            <span>
              Pick a game mode, paste the wallet, and set an agent identity (1-10 chars, letters/numbers/_/-).
            </span>
          </div>
          <div className="step">
            <span className="stepNum">2</span>
            <span>
              Copy the prompt and send it to your agent so it registers with that identity.
            </span>
          </div>
          <div className="step">
            <span className="stepNum">3</span>
            <span>
              Watch your agent compete for energy money live.
            </span>
          </div>
        </div>

        <div className="walletHint">
          <span className="muted">Don't have a Quai wallet?</span>{' '}
          <a
            className="walletLink"
            href="https://docs.qu.ai/learn/use-quai#get-a-quai-wallet"
            target="_blank"
            rel="noreferrer"
          >
            Get one here
          </a>
        </div>

        <div className="modalActions">
          <div className="docActionRow">
            <a className="btn btnPrimary docActionMain" href="/skill.md" target="_blank" rel="noreferrer">
              skill.md
            </a>
            <button
              className="btn docActionDownload"
              aria-label="Download skill.md"
              title="Download skill.md"
              disabled={downloadingSkill}
              onClick={async () => {
                setDownloadError(null);
                setDownloadingSkill(true);
                try {
                  const skillTemplate = await fetchTextFile('/skill.md');
                  const filledSkill = injectOwnerPromptIntoSkillDoc(skillTemplate, prompt);
                  buildDownloadBlob('skill.md', filledSkill);
                } catch (e: any) {
                  setDownloadError(String(e?.message ?? e));
                } finally {
                  setDownloadingSkill(false);
                }
              }}
            >
              {downloadingSkill ? '...' : <DownloadIcon />}
            </button>
          </div>

          <div className="docActionRow">
            <a className="btn docActionMain" href="/heartbeat.md" target="_blank" rel="noreferrer">
              heartbeat.md
            </a>
            <button
              className="btn docActionDownload"
              aria-label="Download heartbeat.md"
              title="Download heartbeat.md"
              disabled={downloadingHeartbeat}
              onClick={async () => {
                setDownloadError(null);
                setDownloadingHeartbeat(true);
                try {
                  const heartbeatTemplate = await fetchTextFile('/heartbeat.md');
                  buildDownloadBlob('heartbeat.md', heartbeatTemplate);
                } catch (e: any) {
                  setDownloadError(String(e?.message ?? e));
                } finally {
                  setDownloadingHeartbeat(false);
                }
              }}
            >
              {downloadingHeartbeat ? '...' : <DownloadIcon />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
