import type { ColorId, GameState } from './types.js';

/**
 * AI 决策视图：隐藏其他座位未亮开的暗扣牌与 Watcher 追加牌。
 *
 * 与 web 客户端视图（占位 'healer' 表示「已暗扣」）不同，agent 视图直接
 * 删除这些条目——对手采样逻辑把「无条目」当作未暗拍处理。
 * 亮牌（revealed）后全部信息公开，无需过滤。
 */
export function agentViewFor(state: GameState, seat: ColorId): GameState {
  const view = JSON.parse(JSON.stringify(state)) as GameState;
  if (!view.revealed) {
    for (const c of Object.keys(view.submissions) as ColorId[]) {
      if (c !== seat) delete view.submissions[c];
    }
  }
  if (view.phase === 'watcher') {
    for (const c of Object.keys(view.watcherCards) as ColorId[]) {
      if (c !== seat) delete view.watcherCards[c];
    }
  }
  return view;
}
