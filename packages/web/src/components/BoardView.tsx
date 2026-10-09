import type { ViewState } from '@xzs/protocol';
import { TRACK, type CharacterCard, type ColorId } from '@xzs/engine';
import { TRACK_COORDS } from '../track-coords.js';
import { COLOR_NAMES } from '../theme.js';
import { CardView } from './CardView.js';

/**
 * 树层锚点：版图裁切图（480×1010）上 1-7 层号牌中心（已对扫描件校准）。
 */
export const LEVEL_ANCHORS: Record<number, { x: number; y: number }> = {
  7: { x: 249, y: 214 },
  6: { x: 243, y: 334 },
  5: { x: 245, y: 445 },
  4: { x: 234, y: 551 },
  3: { x: 260, y: 672 },
  2: { x: 231, y: 770 },
  1: { x: 305, y: 880 },
};

const pct = (x: number, y: number) => ({ left: `${(x / 480) * 100}%`, top: `${(y / 1010) * 100}%` });

export function BoardView({ state }: { state: ViewState }) {
  // 本轮打出的角色牌（亮牌后按层显示在树上）
  const playedByLevel = new Map<number, { color: ColorId; card: CharacterCard }[]>();
  if (state.revealed) {
    for (const p of state.players) {
      const cards: (CharacterCard | string)[] = [];
      const sub = state.submissions[p.color];
      if (sub !== undefined) cards.push(sub as CharacterCard | string);
      const extra = state.watcherCards[p.color];
      if (extra !== undefined) cards.push(extra as CharacterCard | string);
      for (const c of cards) {
        if (typeof c === 'number') {
          if (!playedByLevel.has(c)) playedByLevel.set(c, []);
          playedByLevel.get(c)!.push({ color: p.color, card: c });
        }
      }
    }
  }

  // 计分轨：图腾放在版图轨道上（原版布局）
  const totemsAt = new Map<number, ColorId[]>();
  for (const p of state.players) {
    if (!totemsAt.has(p.trackPos)) totemsAt.set(p.trackPos, []);
    totemsAt.get(p.trackPos)!.push(p.color);
  }

  return (
    <div className="board-wrap">
      <img className="board-img" src="/assets/board.jpg" alt="圣树版图" draggable={false} />

      {/* 轨道图腾 */}
      {TRACK.map((space, i) => {
        const here = totemsAt.get(i) ?? [];
        if (here.length === 0) return null;
        const [x, y] = TRACK_COORDS[i]!;
        return (
          <div key={i} className="track-totem-stack" style={pct(x, y)}>
            {here.map((c, j) => (
              <img
                key={c}
                src={`/assets/totems/${c}.png`}
                alt={c}
                className="track-totem"
                style={{ transform: `translate(${j * 9 - (here.length - 1) * 4.5}px, ${-j * 3}px)` }}
                draggable={false}
              />
            ))}
          </div>
        );
      })}

      {/* 果实与角色牌 */}
      {[7, 6, 5, 4, 3, 2, 1].map((level) => {
        const a = LEVEL_ANCHORS[level]!;
        const fruits = state.treeFruit[level - 1] ?? 0;
        const chars = playedByLevel.get(level) ?? [];
        return (
          <div key={level}>
            {fruits > 0 && (
              <div className="level-fruits" style={pct(a.x - 46, a.y - 8)} title={`第 ${level} 层：${fruits} 个果实`}>
                {Array.from({ length: fruits }, (_, i) => (
                  <img key={i} src="/assets/fruit.png" alt="果实" draggable={false} />
                ))}
              </div>
            )}
            {chars.length > 0 && (
              <div className="level-chars" style={pct(a.x + 34, a.y - 10)}>
                {chars.map((o) => (
                  <CardView key={o.color} color={o.color} card={o.card} small />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {state.winner && (
        <div className="board-winner">
          <span>🏆 {COLOR_NAMES[state.winner]} 色获胜！</span>
        </div>
      )}
    </div>
  );
}
