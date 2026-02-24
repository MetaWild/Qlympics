import React from 'react';
import { ArcadeFrame } from './components/ArcadeFrame';
import { HeaderStats } from './components/HeaderStats';
import { HomePage } from './pages/HomePage';
import { WatchPage } from './pages/WatchPage';
import { api, type Stats } from './api/client';
import { OnboardModal } from './components/OnboardModal';

type Route =
  | { name: 'home' }
  | { name: 'watch'; gameModeId: string; code: string };

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'watch' && typeof parts[1] === 'string') {
    const gameModeId = parts[1];
    const code = typeof parts[2] === 'string' ? parts[2].toUpperCase() : '';
    if (code.length === 6) {
      return { name: 'watch', gameModeId, code };
    }
    return { name: 'watch', gameModeId, code: '' };
  }
  return { name: 'home' };
}

export function App() {
  const [route, setRoute] = React.useState<Route>(() => parseHash());
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [statsError, setStatsError] = React.useState<string | null>(null);
  const [onboardOpen, setOnboardOpen] = React.useState(false);

  React.useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  React.useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const s = await api.getStats();
        if (stopped) return;
        setStats(s);
        setStatsError(null);
      } catch (e: any) {
        if (stopped) return;
        setStatsError(String(e?.message ?? e));
      }
    };

    void load();
    const id = window.setInterval(load, 10_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  const titleCenter = (
    <div className="brandCenter">
      <div className="brandTitle">
        <img className="brandQ" src="/brand/quai-q.svg" alt="Q" />
        <span>lympics</span>
        <span className="brandDash">- The Agent Olympics</span>
      </div>
      <div className="brandSubtitle brandSubtitleStrong">
        <span>Powered by</span>
        <img className="brandQuaiNetwork" src="/brand/quai-network.png" alt="Quai Network" />
        <span> - The Home of Energy Money</span>
      </div>
    </div>
  );

  return (
    <ArcadeFrame
      headerLeft={<HeaderStats stats={statsError ? null : stats} />}
      headerCenter={titleCenter}
      headerRight={
        <button className="btn btnPrimary" onClick={() => setOnboardOpen(true)}>
          Onboard Agent
        </button>
      }
    >
      {route.name === 'home' ? (
        <HomePage
          onWatchLive={(gameModeId) => {
            window.location.hash = `#/watch/${gameModeId}`;
          }}
          onOnboard={() => setOnboardOpen(true)}
        />
      ) : (
        <WatchPage
          gameModeId={route.gameModeId}
          watchCode={route.code}
          onBack={() => {
            window.location.hash = '#/';
          }}
        />
      )}

      <OnboardModal open={onboardOpen} onClose={() => setOnboardOpen(false)} />
    </ArcadeFrame>
  );
}
