import {
  LAST_SPACE,
  agentViewFor,
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
 *
 * 随机性与多样性（避免全 AI 对称撞层）：
 * 1. Boltzmann 择牌：只在「最优 EV − margin」内的候选中按温度采样，差距大选点仍确定，
 *    差距小（近似等价）时随机化（种子注入，重放一致）
 * 2. 座位性格：对角色牌加小幅永久偏好（冲高/蹲低/均衡），只够打破近似平局，
 *    不足以覆盖真实 EV 差距
 */
export class SimulationAgent implements PlayerAgent {
  readonly name = 'simulation';
  constructor(
    private samples = Number(process.env.XZS_AI_SAMPLES ?? 100),
    private temperature = Number(process.env.XZS_AI_TEMPERATURE ?? 1.5),
    private margin = Number(process.env.XZS_AI_MARGIN ?? 3),
  ) {}

  async chooseAction(state: GameState, legal: Action[], seat: ColorId): Promise<Action> {
    if (legal.length === 1) return legal[0]!;
    const view = agentViewFor(state, seat);
    const base: GameState = { ...view, log: [], submissions: { ...view.submissions }, watcherCards: { ...view.watcherCards } };
    // v3：已暗扣的对手，牌张可精确推算（牌堆无重复 + 弃牌/已用/手牌全公开），注入重建真实局面
    for (const c of view.hiddenSubmitted ?? []) {
      const deduced = unaccountedCard(base, c);
      if (deduced !== null) base.submissions[c] = deduced;
    }
    for (const c of view.hiddenWatcherExtras ?? []) {
      const deduced = unaccountedCard(base, c); // watcher 阶段 submissions 已亮，减法同理
      if (deduced !== null) base.watcherCards[c] = deduced;
    }
    // v3：level-1 对手建模——未暗扣对手按「对手自身 EV」加权采样
    const oppWeights = new Map<ColorId, Map<CardId, number>>();
    for (const p of base.players) {
      if (p.color === seat || base.submissions[p.color] !== undefined || p.hand.length === 0) continue;
      oppWeights.set(p.color, refinedOpponentWeights(base, p.color, seat));
    }
    const evs = legal.map((a, i) => ({ action: a, value: this.evaluate(base, a, seat, i, oppWeights) }));
    return boltzmannPick(evs, mixSeed(base, seat, 999), this.temperature, this.margin).action;
  }

  private evaluate(
    state: GameState,
    action: Action,
    seat: ColorId,
    salt: number,
    oppWeights: Map<ColorId, Map<CardId, number>> = new Map(),
  ): number {
    // 模拟不需要战报：剥离 log 大幅减小 applyAction 深拷贝开销
    const base: GameState = { ...state, log: [] };
    if (action.type !== 'submit-card') {
      // watcher / healer：信息全知，精确模拟
      const after = autoResolve(applyAction(base, action));
      return payoff(base, after, seat);
    }
    // 未暗扣对手数：全部已知 → 纯精确评估（1 次，零采样）；否则蒙特卡洛采样
    const unknown = base.players.filter(
      (p) => p.color !== seat && base.submissions[p.color] === undefined && p.hand.length > 0,
    ).length;
    const endgame = base.players.some((p) => p.trackPos >= 20);
    const samples = unknown === 0 ? 1 : endgame ? Math.round(this.samples * 1.5) : this.samples;
    let rng = mixSeed(base, seat, salt);
    let total = 0;
    for (let k = 0; k < samples; k++) {
      const plays = new Map<ColorId, CardId>([[seat, action.card]]);
      for (const p of base.players) {
        if (p.color === seat || base.submissions[p.color] !== undefined) continue;
        const r = nextRandom(rng);
        rng = r.state;
        const w = oppWeights.get(p.color);
        plays.set(p.color, w ? sampleWithWeights(p.hand, w, r.value) : sampleOpponentCard(base, p.color, r.value));
      }
      const sim = applyAllSubmissions(base, plays);
      const resolved = autoResolve(sim);
      let v = payoff(base, resolved, seat);
      // 第二回合前瞻：感知牌经济性；终局加深一层
      if (resolved.phase !== 'finished') {
        const ro = this.rolloutOnce(resolved, seat, rng);
        v += 0.6 * payoff(resolved, ro.state, seat);
        rng = ro.rng;
        if (endgame && ro.state.phase !== 'finished') {
          const ro2 = this.rolloutOnce(ro.state, seat, rng);
          v += 0.36 * payoff(ro.state, ro2.state, seat);
          rng = ro2.rng;
        }
      }
      total += v;
    }
    return total / samples + personaBias(seat, action.card);
  }

  /** 便宜的第二回合推演：全部座位按静态价值出牌（自己 argmax，对手采样），引擎结算。 */
  private rolloutOnce(state: GameState, seat: ColorId, rng: number): { state: GameState; rng: number } {
    let s = state;
    let r = rng;
    const plays = new Map<ColorId, CardId>();
    for (const p of state.players) {
      if (p.hand.length === 0) continue;
      if (p.color === seat) {
        // 自己：静态价值最高的牌（代理未来最优）
        let bestCard = p.hand[0]!;
        let bestV = -Infinity;
        for (const c of p.hand) {
          const v = staticScore(state, p.color, c) + personaBias(p.color, c);
          if (v > bestV) {
            bestV = v;
            bestCard = c;
          }
        }
        plays.set(p.color, bestCard);
      } else {
        const n = nextRandom(r);
        r = n.state;
        plays.set(p.color, sampleOpponentCard(state, p.color, n.value));
      }
    }
    s = applyAllSubmissions(state, plays);
    return { state: autoResolve(s), rng: r };
  }
}

/** 全套牌（每色 10 张）。 */
const FULL_DECK: CardId[] = [1, 2, 3, 4, 5, 6, 7, 'healer', 'watcher', 'blizzard'];

/**
 * 推算已暗扣对手的暗扣牌：
 * 10 − 公开弃牌 − 已用特殊牌 − 手牌 − 已亮牌 = 唯一未销账的牌。
 * 无法唯一确定时返回 null（理论上不会发生）。
 */
function unaccountedCard(state: GameState, color: ColorId): CardId | null {
  const p = playerOf(state, color);
  const left = FULL_DECK.filter(
    (c) =>
      !p.discard.includes(c as never) &&
      !p.usedSpecials.includes(c as never) &&
      !p.hand.includes(c) &&
      state.submissions[color] !== c,
  );
  return left.length === 1 ? left[0]! : null;
}

/** level-1 对手建模：未暗扣对手的每张牌按「对手自身 EV」softmax 加权（对手也是优化者）。 */
function refinedOpponentWeights(
  base: GameState,
  oppColor: ColorId,
  seat: ColorId,
  quickSamples = 12,
  temp = 6,
): Map<CardId, number> {
  const opp = playerOf(base, oppColor);
  const evs = new Map<CardId, number>();
  for (const c of opp.hand) {
    let rng = mixSeed(base, oppColor, String(c).charCodeAt(0) * 7 + 13);
    let total = 0;
    for (let k = 0; k < quickSamples; k++) {
      const plays = new Map<ColorId, CardId>([[oppColor, c]]);
      for (const p of base.players) {
        if (p.color === oppColor || p.color === seat || base.submissions[p.color] !== undefined) continue;
        const r = nextRandom(rng);
        rng = r.state;
        plays.set(p.color, sampleOpponentCard(base, p.color, r.value));
      }
      const me = playerOf(base, seat);
      if (base.submissions[seat] === undefined && me.hand.length > 0) {
        const r = nextRandom(rng);
        rng = r.state;
        plays.set(seat, sampleOpponentCard(base, seat, r.value));
      }
      const resolved = autoResolve(applyAllSubmissions(base, plays));
      total += payoff(base, resolved, oppColor);
    }
    evs.set(c, total / quickSamples);
  }
  const best = Math.max(...evs.values());
  const weights = new Map<CardId, number>();
  for (const [c, ev] of evs) weights.set(c, Math.max(0.03, Math.exp((ev - best) / temp)));
  return weights;
}

function sampleWithWeights(hand: CardId[], weights: Map<CardId, number>, rand: number): CardId {
  let sum = 0;
  for (const c of hand) sum += weights.get(c) ?? 0.05;
  let pick = rand * sum;
  for (const c of hand) {
    pick -= weights.get(c) ?? 0.05;
    if (pick <= 0) return c;
  }
  return hand[hand.length - 1]!;
}

/** 确定性采样种子。 */
function mixSeed(state: GameState, seat: ColorId, salt: number): number {
  let h = (state.rngState ^ (state.round * 0x9e3779b9) ^ (salt * 0x85ebca6b)) >>> 0;
  for (const ch of seat) h = Math.imul(h ^ ch.charCodeAt(0), 0xc2b2ae35) >>> 0;
  return h >>> 0;
}

/**
 * Boltzmann 择牌：只考虑「最优 EV − margin」内的候选，按温度加权采样。
 * 温度 → 0 退化为 argmax；margin 保证明显的最优解不受随机化影响。
 */
export function boltzmannPick<T extends { value: number }>(
  items: T[],
  seed: number,
  temperature = 4,
  margin = 6,
): T {
  if (items.length <= 1) return items[0]!;
  const best = Math.max(...items.map((i) => i.value));
  const pool = items.filter((i) => i.value >= best - margin);
  if (pool.length <= 1) return pool[0] ?? items[0]!;
  const { value, state } = nextRandom(seed);
  void state;
  const weights = pool.map((i) => Math.exp((i.value - best) / temperature));
  const sum = weights.reduce((a, b) => a + b, 0);
  let pick = value * sum;
  for (let i = 0; i < pool.length; i++) {
    pick -= weights[i]!;
    if (pick <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

/**
 * 座位性格：角色牌小幅永久偏好（冲高/蹲低/均衡），幅度 ≤0.8，
 * 只用于打破近平局，不覆盖真实 EV 差距。
 */
export function personaBias(seat: ColorId, card: CardId): number {
  if (!isCharacter(card)) return 0;
  let h = 0;
  for (const ch of seat) h = (h * 13 + ch.charCodeAt(0)) % 997;
  const style = h % 3; // 0 冲高 1 蹲低 2 均衡
  if (style === 0) return card >= 6 ? 0.8 : card <= 3 ? -0.4 : 0;
  if (style === 1) return card <= 2 ? 0.8 : card >= 6 ? -0.4 : 0;
  return 0;
}

/** 对手暗拍建模：按静态价值加权采样（果实/法力站位/特殊牌场景价值）。 */
function sampleOpponentCard(state: GameState, color: ColorId, rand: number): CardId {
  const p = playerOf(state, color);
  const weights = p.hand.map((c) => Math.max(0.05, staticScore(state, p.color, c) + personaBias(p.color, c)));
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

/** 按座位顺序应用一组暗拍（防御：跳过已提交/非 submit 阶段）。 */
function applyAllSubmissions(state: GameState, plays: Map<ColorId, CardId>): GameState {
  let s = state;
  for (const p of state.players) {
    const card = plays.get(p.color);
    if (card !== undefined && s.phase === 'submit' && s.submissions[p.color] === undefined) {
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
    let best: Action;
    if (seatLegal[0]!.type === 'healer-recover') {
      // Healer 子决策用廉价启发式：回收静态价值最高的 2 张。
      // （精确评估代价是「组合数 × 递归模拟 × 采样 × 候选」的大乘数，
      // 而 Healer 选择对本回合结算几乎无影响——只改手牌构成）
      best = cheapHealerPick(s, seatLegal);
    } else {
      // Watcher 追加：候选少，保持精确评估（发现收割/避险杀招）
      best = seatLegal[0]!;
      let bestV = -Infinity;
      for (const a of seatLegal) {
        const after = applyAction(s, a);
        const resolved =
          after.phase === 'watcher' || after.phase === 'healer' ? autoResolve(after, depth + 1) : after;
        const v = payoff(s, resolved, seat);
        if (v > bestV) {
          bestV = v;
          best = a;
        }
      }
    }
    s = applyAction(s, best);
  }
  return s;
}

function cheapHealerPick(s: GameState, seatLegal: Action[]): Action {
  let best = seatLegal[0]!;
  let bestV = -Infinity;
  for (const a of seatLegal) {
    if (a.type !== 'healer-recover') continue;
    const v = a.cards.reduce(
      (sum, c) => sum + (s.treeFruit[c - 1] ?? 0) * 2 + (c <= 2 ? 0.8 : 0) + c * 0.05,
      a.cards.length * 0.5,
    );
    if (v > bestV) {
      bestV = v;
      best = a;
    }
  }
  return best;
}

/**
 * 收益函数：自己计分轨进展为主，弃牌损失与对手进展为辅。
 */
export function payoff(before: GameState, after: GameState, seat: ColorId): number {
  if (after.winner === seat) return 10000;
  if (after.winner !== null) return -10000;
  const meA = playerOf(after, seat);
  const meB = playerOf(before, seat);
  // 终局紧迫感：自己越接近终点，每一分越值钱
  let v = (meA.trackPos - meB.trackPos) * 10 * (1 + 0.8 * (meB.trackPos / LAST_SPACE));
  // 角色牌被打入弃牌堆 = 节奏损失（需 Healer 回收）
  v -= (meA.discard.length - meB.discard.length) * 1.5;
  // 用完一次性特殊牌的机会成本（Watcher/Blizzard 比 Healer 值钱）
  for (const c of meA.usedSpecials) {
    if (!meB.usedSpecials.includes(c)) v -= c === 'blizzard' ? 0.8 : 0.5;
  }
  // 手牌弹性
  v += (meA.hand.filter(isCharacter).length - meB.hand.filter(isCharacter).length) * 0.4;
  // 对手进展施压：领先者（接近终点）的每一分更伤，二次曲线强化终局压制意识
  for (const p of after.players) {
    if (p.color === seat) continue;
    const oppB = playerOf(before, p.color);
    v -= (p.trackPos - oppB.trackPos) * (1.2 + 5 * Math.pow(oppB.trackPos / LAST_SPACE, 2));
  }
  return v;
}
