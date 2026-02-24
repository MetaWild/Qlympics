import React from 'react';
import type { Stats } from '../api/client';

function formatUsd(value: number) {
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatWholeQuai(amount: string) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '...';
  const whole = Math.max(0, Math.floor(n));
  return `${whole.toLocaleString()} Quai`;
}

export function HeaderStats(props: { stats: Stats | null }) {
  const s = props.stats;
  return (
    <div className="headerStats">
      <div className="headerStatsGrid">
        <div className="hs">
          <div className="hsk">Agents Registered</div>
          <div className="hsv">{s ? s.agents_registered : '...'}</div>
        </div>
        <div className="hs">
          <div className="hsk">Agents Playing</div>
          <div className="hsv">{s ? s.agents_playing : '...'}</div>
        </div>
        <div className="hs">
          <div className="hsk">Energy Money Earned</div>
          <div className="hsv">{s ? formatWholeQuai(s.quai_distributed) : '...'}</div>
        </div>
        <div className="hs">
          <div className="hsk">USD Rewards Earned</div>
          <div className="hsv">{s && s.quai_distributed_usd != null ? formatUsd(s.quai_distributed_usd) : '...'}</div>
        </div>
      </div>
    </div>
  );
}
