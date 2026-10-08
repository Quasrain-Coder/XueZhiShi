import { useEffect, useSyncExternalStore } from 'react';
import { net } from './net.js';
import { Home } from './views/Home.js';
import { Lobby } from './views/Lobby.js';
import { Game } from './views/Game.js';

export function App() {
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
    return <Game room={net.room} state={net.state} />;
  }
  if (net.room) {
    return <Lobby room={net.room} />;
  }
  return <Home error={net.error} />;
}
