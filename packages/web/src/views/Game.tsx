import { useState } from 'react';
import { isCharacter, type CharacterCard, type ColorId } from '@xzs/engine';
import type { RoomInfo, ViewState } from '@xzs/protocol';
import { net } from '../net.js';
import { COLOR_CSS, COLOR_NAMES } from '../theme.js';
import { BoardView } from '../components/BoardView.js';
import { TrackView } from '../components/TrackView.js';
import { CardView } from '../components/CardView.js';

export function Game({ room, state }: { room: RoomInfo; state: ViewState }) {
  const yours = state.yours ?? [];
  const [activeSeat, setActiveSeat] = useState<ColorId | null>(null);
  const [healerPick, setHealerPick] = useState<CharacterCard[]>([]);

  // 当前需要我决策的座位
  const pendingSeats: { seat: ColorId; kind: 'submit' | 'watcher' | 'healer' }[] = [];
  if (state.phase === 'submit') {
    for (const c of yours) {
      if (state.submissions[c] === undefined) pendingSeats.push({ seat: c, kind: 'submit' });
    }
  } else if (state.phase === 'watcher') {
    for (const c of yours) if (state.pendingWatcher.includes(c)) pendingSeats.push({ seat: c, kind: 'watcher' });
  } else if (state.phase === 'healer') {
    for (const c of yours) if (state.pendingHealer.includes(c)) pendingSeats.push({ seat: c, kind: 'healer' });
  }
  const current = pendingSeats.find((p) => p.seat === activeSeat) ?? pendingSeats[0] ?? null;
  const me = current ? state.players.find((p) => p.color === current.seat) : null;

  const submit = (card: CharacterCard | 'healer' | 'watcher' | 'blizzard') => {
    if (!current) return;
    if (current.kind === 'submit') {
      net.send({ type: 'submit-action', action: { type: 'submit-card', player: current.seat, card } });
    } else if (current.kind === 'watcher') {
      net.send({ type: 'submit-action', action: { type: 'watcher-play', player: current.seat, card } });
    }
    setActiveSeat(null);
  };

  const confirmHealer = () => {
    if (!current) return;
    net.send({
      type: 'submit-action',
      action: { type: 'healer-recover', player: current.seat, cards: healerPick },
    });
    setHealerPick([]);
    setActiveSeat(null);
  };

  return (
    <div className="game">
      <header className="game-header">
        <span>
          房间 <b>{room.code}</b> · 第 <b>{state.round}</b> 回合 · 果实储备 {state.fruitReserve}
          {state.lastDice.length > 0 && (
            <span className="dice">
              {state.lastDice.map((d, i) => (
                <Die key={i} value={d} />
              ))}
            </span>
          )}
        </span>
        <span>
          {yours.length > 0 && `你的座位：${yours.map((c) => COLOR_NAMES[c]).join('、')}`}
          <button className="link" onClick={() => net.leave()}>
            离开
          </button>
        </span>
      </header>

      <div className="game-main">
        <aside className="game-left">
          <TrackView state={state} />
        </aside>

        <section className="game-center">
          {state.winner ? (
            <div className="winner-banner">
              🏆 {COLOR_NAMES[state.winner]} 色获胜！
              <button className="link" onClick={() => net.leave()}>
                返回首页
              </button>
            </div>
          ) : (
            current &&
            me && (
              <div className="prompt" style={{ borderColor: COLOR_CSS[current.seat] }}>
                {current.kind === 'submit' && (
                  <>
                    为 <b style={{ color: COLOR_CSS[current.seat] }}>{COLOR_NAMES[current.seat]}</b> 选择一张牌暗扣
                    {pendingSeats.length > 1 && (
                      <span className="prompt-seats">
                        （待决策：{pendingSeats.map((p) => COLOR_NAMES[p.seat]).join('、')}）
                      </span>
                    )}
                  </>
                )}
                {current.kind === 'watcher' && (
                  <>
                    <b style={{ color: COLOR_CSS[current.seat] }}>{COLOR_NAMES[current.seat]}</b> 的 Watcher：
                    从手牌再打出一张
                  </>
                )}
                {current.kind === 'healer' && (
                  <>
                    <b style={{ color: COLOR_CSS[current.seat] }}>{COLOR_NAMES[current.seat]}</b> 的 Healer：
                    从弃牌选至多 2 张回收（{healerPick.length}/2）
                    <button className="primary" onClick={confirmHealer}>
                      确认
                    </button>
                  </>
                )}
              </div>
            )
          )}
          <BoardView state={state} />
        </section>

        <aside className="game-right">
          <div className="players">
            {state.players.map((p) => (
              <div key={p.color} className={`player-row ${yours.includes(p.color) ? 'player-me' : ''}`}>
                <img className="player-totem" src={`/assets/totems/${p.color}.png`} alt="" draggable={false} />
                <span className="player-name" style={{ color: COLOR_CSS[p.color] }}>
                  {COLOR_NAMES[p.color]}
                </span>
                <span className="player-pos">{p.trackPos}</span>
                <span className="player-detail">
                  手牌 {p.hand.length} · 弃 {p.discard.length} · 特殊 {p.usedSpecials.length}
                </span>
                <span className="player-sub">
                  {state.phase !== 'finished' &&
                    (state.submissions[p.color] !== undefined ? (state.revealed ? '✓' : '🔒') : '…')}
                </span>
              </div>
            ))}
          </div>
          <div className="log">
            {state.log.slice(-40).map((e, i) => (
              <p key={i}>
                <span className="log-round">R{e.round}</span> {e.text}
              </p>
            ))}
          </div>
        </aside>
      </div>

      {me && current && (
        <footer className="game-hand">
          {current.kind === 'healer' ? (
            <div className="hand">
              <span className="hand-label">弃牌堆（点击选择）：</span>
              {me.discard.length === 0 && <span className="hint">（空）</span>}
              {me.discard.map((c, i) => (
                <CardView
                  key={`${c}-${i}`}
                  color={me.color}
                  card={c}
                  small
                  selected={healerPick.includes(c)}
                  onClick={() => {
                    if (healerPick.includes(c)) setHealerPick(healerPick.filter((x) => x !== c));
                    else if (healerPick.length < 2) setHealerPick([...healerPick, c]);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="hand">
              <span className="hand-label" style={{ color: COLOR_CSS[me.color] }}>
                {COLOR_NAMES[me.color]} 手牌：
              </span>
              {[...me.hand]
                .sort((a, b) => (isCharacter(a) ? a : 8) - (isCharacter(b) ? b : 8))
                .map((c, i) => (
                  <CardView key={`${c}-${i}`} color={me.color} card={c} onClick={() => submit(c)} />
                ))}
            </div>
          )}
          {pendingSeats.length > 1 && (
            <div className="seat-switch">
              {pendingSeats.map((p) => (
                <button
                  key={p.seat}
                  className={p.seat === current.seat ? 'active' : ''}
                  onClick={() => setActiveSeat(p.seat)}
                >
                  {COLOR_NAMES[p.seat]}
                </button>
              ))}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

function Die({ value }: { value: number }) {
  const PIPS: Record<number, [number, number][]> = {
    1: [[50, 50]],
    2: [
      [25, 25],
      [75, 75],
    ],
    3: [
      [25, 25],
      [50, 50],
      [75, 75],
    ],
    4: [
      [25, 25],
      [75, 25],
      [25, 75],
      [75, 75],
    ],
    5: [
      [25, 25],
      [75, 25],
      [50, 50],
      [25, 75],
      [75, 75],
    ],
    6: [
      [25, 25],
      [75, 25],
      [25, 50],
      [75, 50],
      [25, 75],
      [75, 75],
    ],
  };
  return (
    <span className="die">
      {(PIPS[value] ?? []).map(([x, y], i) => (
        <i key={i} style={{ left: `${x}%`, top: `${y}%` }} />
      ))}
    </span>
  );
}
