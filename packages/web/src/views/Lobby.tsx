import type { RoomInfo } from '@xzs/protocol';
import { net } from '../net.js';
import { COLOR_NAMES } from '../theme.js';

export function Lobby({ room }: { room: RoomInfo }) {
  return (
    <div className="lobby">
      <h1>雪之时 · 大厅</h1>
      <p className="room-code">
        房间码：<b>{room.code}</b>（分享给朋友加入）
      </p>
      <ul className="seat-list">
        {room.seats.map((s) => (
          <li key={s.color} className={`seat seat-${s.color}`}>
            <span className="seat-color">{COLOR_NAMES[s.color]}</span>
            <span className="seat-name">
              {s.kind === 'human'
                ? s.nickname
                  ? `${s.nickname}${s.connected ? '' : '（离线）'}`
                  : '（待认领）'
                : s.kind === 'llm'
                  ? 'Claude LLM'
                  : '启发式 AI'}
            </span>
            <span className="seat-actions">
              {s.kind === 'human' && !s.nickname && (
                <>
                  <button onClick={() => net.send({ type: 'claim-seat', color: s.color })}>认领</button>
                  <button onClick={() => net.send({ type: 'set-seat-kind', color: s.color, kind: 'heuristic' })}>
                    AI
                  </button>
                  <button onClick={() => net.send({ type: 'set-seat-kind', color: s.color, kind: 'llm' })}>LLM</button>
                </>
              )}
              {s.kind !== 'human' && (
                <button onClick={() => net.send({ type: 'set-seat-kind', color: s.color, kind: 'human' })}>
                  转人类
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <button className="primary" onClick={() => net.send({ type: 'start-game' })}>
        开始游戏
      </button>
      <button className="link" onClick={() => net.leave()}>
        离开
      </button>
      {net.error && <p className="error">{net.error}</p>}
    </div>
  );
}
