import { isCharacter, type Action, type CardId, type ColorId, type GameState } from '@xzs/engine';
import type { PlayerAgent } from './index.js';

/**
 * 启发式 AI：
 * - 角色牌：果实期望 ×3 + 低层法力站位 + 战斗风险评估（watcher 阶段信息全知，精确评估）
 * - Blizzard：对手角色牌多时掀桌
 * - Healer：回收果实期望最高的弃牌
 */
export class HeuristicAgent implements PlayerAgent {
  readonly name = 'heuristic';

  async chooseAction(state: GameState, legal: Action[], seat: ColorId): Promise<Action> {
    let best: Action | null = null;
    let bestScore = -Infinity;
    for (const a of legal) {
      const s = this.score(state, a, seat);
      if (s > bestScore) {
        bestScore = s;
        best = a;
      }
    }
    if (!best) throw new Error('no legal action');
    return best;
  }

  private score(state: GameState, a: Action, seat: ColorId): number {
    switch (a.type) {
      case 'submit-card':
        return this.scoreSubmit(state, seat, a.card);
      case 'watcher-play':
        return this.scoreWatcher(state, seat, a.card);
      case 'healer-recover': {
        // 回收果实期望最高的牌
        let s = a.cards.length * 0.5;
        for (const c of a.cards) s += (state.treeFruit[c - 1] ?? 0) * 2 + (c <= 2 ? 0.8 : 0);
        return s;
      }
    }
  }

  /** 确定性抖动：打破对称，避免所有 AI 每回合撞同一层。 */
  private jitter(state: GameState, seat: ColorId, salt: number): number {
    let h = state.round * 31 + salt * 17;
    for (const ch of seat) h = (h * 13 + ch.charCodeAt(0)) % 997;
    return (h % 10) / 25; // 0 ~ 0.36
  }

  private scoreSubmit(state: GameState, seat: ColorId, card: CardId): number {
    if (isCharacter(card)) {
      const fruit = state.treeFruit[card - 1] ?? 0;
      const manaStance = card <= 2 ? 1.2 : card <= 4 ? 0.4 : 0;
      // 高位牌留着抢高层果实；轻微保留倾向
      return fruit * 3 + manaStance + card * 0.05 + this.jitter(state, seat, card);
    }
    const me = state.players.find((p) => p.color === seat);
    const others = state.players.filter((p) => p.color !== seat);
    switch (card) {
      case 'healer':
        return (me?.discard.length ?? 0) >= 2 ? 2.2 : -2;
      case 'watcher':
        // 信息价值：场上有果实且手牌有弹性
        return 1.0 + Math.min(2, Math.max(...state.treeFruit) * 0.5);
      case 'blizzard': {
        // 人多后期才掀桌；开局掀桌收益极低
        const enemyChars = others.filter((p) => p.hand.some(isCharacter)).length;
        const late = state.round >= 4 || (me?.discard.length ?? 0) > 0;
        return enemyChars >= 3 && late ? 1.0 : enemyChars >= 4 ? 1.2 : -3;
      }
    }
  }

  private scoreWatcher(state: GameState, seat: ColorId, card: CardId): number {
    if (!isCharacter(card)) return this.scoreSubmit(state, seat, card);
    // Watcher 阶段已全知本轮打出的牌
    const onLevel: ColorId[] = [];
    const above: ColorId[] = [];
    for (const p of state.players) {
      if (p.color === seat) continue;
      const sub = state.submissions[p.color];
      if (sub !== undefined && isCharacter(sub)) {
        if (sub === card) onLevel.push(p.color);
        if (sub === card + 1) above.push(p.color);
      }
    }
    // 上方有独处敌人 → 会被击败
    const aboveSolo = above.length === 1;
    let score = 0;
    if (aboveSolo) score -= 4;
    if (onLevel.length > 0) {
      // 互殴：得 onLevel.length 战斗分但弃牌
      score += onLevel.length * 2.5 - 1.5;
    } else if (!aboveSolo) {
      // 幸存：果实 + 可能的法力
      score += (state.treeFruit[card - 1] ?? 0) * 3 + (card <= 2 ? 1.0 : 0);
      // 我们独处且正下方有敌人 → 收割
      // （精确性有限，足够用）
    }
    return score + card * 0.05;
  }
}
