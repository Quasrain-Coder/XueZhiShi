import type { ViewState } from '@xzs/protocol';
import { isCharacter, type ColorId } from '@xzs/engine';
import { CardView } from './CardView.js';

/**
 * 树层锚点：版图裁切图（480×1010 原始坐标）上 1-7 层的中心位置（百分比）。
 * 转录自规则书版图扫描件。
 */
export const LEVEL_ANCHORS: Record<number, { x: number; y: number }> = {
  7: { x: 51.9, y: 21.2 },
  6: { x: 50.6, y: 33.1 },
  5: { x: 51.0, y: 44.1 },
  4: { x: 48.8, y: 54.6 },
  3: { x: 54.2, y: 66.5 },
  2: { x: 48.1, y: 76.2 },
  1: { x: 63.5, y: 87.1 },
};

export function BoardView({ state }: { state: ViewState }) {
  // 本轮打出的角色牌（亮牌后按层显示）
  const playedByLevel = new Map<number, { color: ColorId; card: number }[]>();
  if (state.revealed) {
    const all: Partial<Record<ColorId, (number | string)[]>> = {};
    for (const p of state.players) {
      const cards: (number | string)[] = [];
      const sub = state.submissions[p.color];
      if (sub !== undefined) cards.push(sub);
      const extra = state.watcherCards[p.color];
      if (extra !== undefined) cards.push(extra);
      if (cards.length) all[p.color] = cards;
    }
    for (const [color, cards] of Object.entries(all) as [ColorId, (number | string)[]][]) {
      for (const c of cards) {
        if (typeof c === 'number') {
          if (!playedByLevel.has(c)) playedByLevel.set(c, []);
          playedByLevel.get(c)!.push({ color, card: c });
        }
      }
    }
  }

  return (
    <div className="board-wrap">
      <img className="board-img" src="/assets/board.jpg" alt="圣树版图" draggable={false} />
      {[7, 6, 5, 4, 3, 2, 1].map((level) => {
        const anchor = LEVEL_ANCHORS[level]!;
        const fruits = state.treeFruit[level - 1] ?? 0;
        const chars = playedByLevel.get(level) ?? [];
        return (
          <div key={level}>
            {fruits > 0 && (
              <div
                className="level-fruits"
                style={{ left: `${anchor.x - 14}%`, top: `${anchor.y}%` }}
                title={`第 ${level} 层：${fruits} 个果实`}
              >
                {Array.from({ length: fruits }, (_, i) => (
                  <img key={i} src="/assets/fruit.png" alt="果实" draggable={false} />
                ))}
              </div>
            )}
            {chars.length > 0 && (
              <div className="level-chars" style={{ left: `${anchor.x + 4}%`, top: `${anchor.y - 3}%` }}>
                {chars.map((o) => (
                  <CardView key={o.color} color={o.color} card={o.card as 1} small />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
