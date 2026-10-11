import { useEffect, useState, useSyncExternalStore } from 'react';
import { net } from './net.js';
import { Home } from './views/Home.js';
import { Lobby } from './views/Lobby.js';
import { Game } from './views/Game.js';

export function App() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/version')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { sha?: string; startedAt?: string } | null) => {
        if (d?.sha) setVersion(`${d.sha.slice(0, 7)} · ${new Date(d.startedAt ?? '').toLocaleString()}`);
      })
      .catch(() => {});
  }, []);
  useEffect(() => net.connect(), []);
  useSyncExternalStore(
    (fn) => net.subscribe(fn),
    () => net,
  );
  // 触发重渲染：订阅 net 变化
  useSyncExternalStore(
    (fn) => net.subscribe(fn),
    () => net.room,
  );
  useSyncExternalStore(
    (fn) => net.subscribe(fn),
    () => net.state,
  );

  if (net.room?.started && net.state) {
    return <Game room={net.room} state={net.state} version={version} />;
  }
  if (net.room) {
    return <Lobby room={net.room} />;
  }
  return <Home error={net.error} version={version} />;
}
