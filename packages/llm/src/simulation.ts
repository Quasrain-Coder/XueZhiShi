import {
  applyAction,
  enumerateActions,
  isCharacter,
  nextRandom,
  playerOf,
  type Action,
  type CardId,
  type ColorId,
  type GameState,
} from '@xzs/engine';
import type { PlayerAgent } from './index.js';

/**
 * 蒙特卡洛模拟 AI。
 *
 * 关键洞察：《雪之时》亮牌后的回合结算完全确定，且对手剩余手牌公开可推算
 * （弃牌面朝上），唯一未知是对手本轮暗拍哪张。因此：
 * - submit 阶段：对我每张候选牌，采样 K 组对手暗拍组合，用引擎精确模拟
 *   整回合结算（含战斗/果实/法力/奖励格），取期望收益最大的牌
 * - watcher/healer 阶段：信息全知，对每个候选精确模拟取最优
 *
 * 模拟内嵌贪婪的子决策（watcher 追加、healer 回收），采样用注入种子保证确定性。
 */
export class SimulationAgent implements PlayerAgent {
  readonly name = 'simulation';
  /** 采样数可用 XZS_AI_SAMPLES 覆盖（按机器性能调）。 */
  constructor(private samples = Number(process.env.XZS_AI_SAMPLES ?? 120)) {}

  async chooseAction(state: GameState, legal: Action[], seat: ColorId): Promise<Action> {
    if (legal.length === 1) return legal[0]!;
    let best: Action | null = null;
    let bestV = -Infinity;
    let salt = 0;
    for (const a of legal) {
      const v = this.evaluate(state, a, seat, salt++);
      if (v > bestV) {
        bestV = v;
        best = a;
      }
    }
    if (!best) throw new Error('no legal action');
    return best;
  }

  private evaluate(state: GameState, action: Action, seat: ColorId, salt: number): number {
    // 模拟不需要战报：剥离 log 大幅减小 applyAction 深拷贝开销
    const base: GameState = { ...state, log: [] };
    if (action.type !== 'submit-card') {
      // watcher / healer：信息全知，精确模拟
      const after = autoResolve(applyAction(base, action));
      return payoff(base, after, seat);
    }
    // submit：采样对手暗拍
    let rng = mixSeed(base, seat, salt);
    let total = 0;
    for (let k = 0; k < this.samples; k++) {
      const plays = new Map<ColorId, CardId>([[seat, action.card]]);
      for (const p of base.players) {
        if (p.color === seat || base.submissions[p.color] !== undefined) continue;
        const r = nextRandom(rng);
        rng = r.state;
        plays.set(p.color, sampleOpponentCard(base, p.color, r.value));
      }
      const sim = applyAllSubmissions(base, plays);
      total += payoff(base, autoResolve(sim), seat);
    }
    return total / this.samples;
  }
}

/** 确定性采样种子。 */
function mixSeed(state: GameState, seat: ColorId, salt: number): number {
  let h = (state.rngState ^ (state.round * 0x9e3779b9) ^ (salt * 0x85ebca6b)) >>> 0;
  for (const ch of seat) h = Math.imul(h ^ ch.charCodeAt(0), 0xc2b2ae35) >>> 0;
  return h >>> 0;
}

/** 对手暗拍建模：按静态价值加权采样（果实/法力站位/特殊牌场景价值）。 */
function sampleOpponentCard(state: GameState, color: ColorId, rand: number): CardId {
  const p = playerOf(state, color);
  const weights = p.hand.map((c) => Math.max(0.05, staticScore(state, p.color, c)));
  const sum = weights.reduce((a, b) => a + b, 0);
  let pick = rand * sum;
  for (let i = 0; i < p.hand.length; i++) {
    pick -= weights[i]!;
    if (pick <= 0) return p.hand[i]!;
  }
  return p.hand[p.hand.length - 1]!;
}

function staticScore(state: GameState, color: ColorId, card: CardId): number {
  if (isCharacter(card)) {
    return (state.treeFruit[card - 1] ?? 0) * 3 + (card <= 2 ? 1.2 : card <= 4 ? 0.4 : 0) + card * 0.05;
  }
  const p = playerOf(state, color);
  const othersHaveChars = state.players.some((q) => q.color !== color && q.hand.some(isCharacter));
  switch (card) {
    case 'healer':
      return p.discard.length >= 2 ? 2.2 : 0.1;
    case 'watcher':
      return 1.0 + Math.min(2, Math.max(...state.treeFruit) * 0.5);
    case 'blizzard':
      return othersHaveChars && state.round >= 4 ? 1.2 : 0.05;
  }
}

/** 按座位顺序应用一组暗拍。 */
function applyAllSubmissions(state: GameState, plays: Map<ColorId, CardId>): GameState {
  let s = state;
  for (const p of state.players) {
    const card = plays.get(p.color);
    if (card !== undefined && s.phase === 'submit') {
      s = applyAction(s, { type: 'submit-card', player: p.color, card });
    }
  }
  return s;
}

/**
 * 自动推进回合：watcher 追加与 healer 回收用精确评估贪婪选择，
 * 直到进入下一轮 submit 或游戏结束。
 */
export function autoResolve(state: GameState, depth = 0): GameState {
  let s = state;
  let guard = 0;
  while ((s.phase === 'watcher' || s.phase === 'healer') && guard++ < 20) {
    const legal = enumerateActions(s);
    if (legal.length === 0) break;
    const seat = legal[0]!.player;
    const seatLegal = legal.filter((a) => a.player === seat);
    let best = seatLegal[0]!;
    let bestV = -Infinity;
    for (const a of seatLegal) {
      const after = applyAction(s, a);
      const resolved = after.phase === 'watcher' || after.phase === 'healer' ? autoResolve(after, depth + 1) : after;
      const v = payoff(s, resolved, seat);
      if (v > bestV) {
        bestV = v;
        best = a;
      }
    }
    s = applyAction(s, best);
  }
  return s;
}

/**
 * 收益函数：自己计分轨进展为主，弃牌损失与对手进展为辅。
 */
export function payoff(before: GameState, after: GameState, seat: ColorId): number {
  if (after.winner === seat) return 10000;
  if (after.winner !== null) return -10000;
  const meA = playerOf(after, seat);
  const meB = playerOf(before, seat);
  let v = (meA.trackPos - meB.trackPos) * 10;
  // 角色牌被打入弃牌堆 = 节奏损失（需 Healer 回收）
  v -= (meA.discard.length - meB.discard.length) * 1.5;
  // 用完一次性特殊牌的机会成本（Watcher/Blizzard 比 Healer 值钱）
  for (const c of meA.usedSpecials) {
    if (!meB.usedSpecials.includes(c)) v -= c === 'blizzard' ? 0.8 : 0.5;
  }
  // 手牌弹性
  v += (meA.hand.filter(isCharacter).length - meB.hand.filter(isCharacter).length) * 0.4;
  // 对手进展施压
  for (const p of after.players) {
    if (p.color === seat) continue;
    v -= (p.trackPos - playerOf(before, p.color).trackPos) * 1.2;
  }
  return v;
}
