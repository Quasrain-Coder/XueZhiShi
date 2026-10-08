import { useState } from 'react';
import { net } from '../net.js';

export function Home({ error }: { error: string | null }) {
  const [nickname, setNickname] = useState(localStorage.getItem('xzs-nick') ?? '');
  const [code, setCode] = useState('');
  const [seats, setSeats] = useState(3);

  const nick = () => {
    const n = nickname.trim() || '玩家';
    localStorage.setItem('xzs-nick', n);
    return n;
  };

  return (
    <div className="home" style={{ backgroundImage: 'url(/assets/cover.jpg)' }}>
      <div className="home-panel">
        <h1 className="logo">雪之时</h1>
        <p className="tagline">Snow Time · 圣树果实争夺战</p>
        <label>
          昵称
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="玩家" />
        </label>
        <div className="home-row">
          <label>
            座位数
            <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} 色
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => net.send({ type: 'create-room', nickname: nick(), seats })}>创建房间</button>
        </div>
        <div className="home-row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="房间码"
            maxLength={6}
          />
          <button disabled={!code} onClick={() => net.send({ type: 'join-room', code, nickname: nick() })}>
            加入房间
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="hint">2 人玩法：建 4 色房间，每人认领 2 个颜色（官方 2 人变体）。</p>
      </div>
    </div>
  );
}
