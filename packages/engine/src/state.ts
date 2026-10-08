import { FRUIT_TOTAL, LAST_SPACE, TRACK, TREE_LEVELS, startingDeck } from './data/track.js';
import { rollDie } from './rng.js';
import {
  type CardId,
  type CharacterCard,
  type ColorId,
  type GameState,
  type PlayerState,
  type PointType,
  emptyPoints,
  isCharacter,
} from './types.js';

export function newGame(colors: ColorId[], seed: number): GameState {
  const players: PlayerState[] = colors.map((color) => ({
    color,
    hand: startingDeck(),
    discard: [],
    usedSpecials: [],
    trackPos: 0,
    roundPoints: emptyPoints(),
  }));
  const state: GameState = {
    rngState: seed >>> 0,
    seed: seed >>> 0,
    round: 1,
    players,
    treeFruit: Array.from({ length: TREE_LEVELS }, () => 0),
    fruitReserve: FRUIT_TOTAL,
    phase: 'submit',
    submissions: {},
    revealed: false,
    pendingWatcher: [],
    watcherCards: {},
    pendingHealer: [],
    playedCards: {},
    lastDice: [],
    winner: null,
    log: [],
  };
  placeFruit(state);
  return state;
}

export function playerOf(state: GameState, color: ColorId): PlayerState {
  const p = state.players.find((pl) => pl.color === color);
  if (!p) throw new Error(`unknown player ${color}`);
  return p;
}

/** 回合开始放置果实（§4.1）。 */
export function placeFruit(state: GameState): void {
  state.lastDice = [];
  if (state.fruitReserve <= 0) return;
  const diceCount = state.fruitReserve >= 2 ? 2 : 1;
  const rolls: number[] = [];
  for (let i = 0; i < diceCount; i++) {
    const { value, state: s } = rollDie(state.rngState);
    state.rngState = s;
    rolls.push(value);
  }
  state.lastDice = rolls;
  const placed: number[] = [];
  for (const level of rolls) {
    if (state.fruitReserve <= 0) break;
    if (level >= TREE_LEVELS) continue; // 第 7 层永不放果实
    state.treeFruit[level - 1] = (state.treeFruit[level - 1] ?? 0) + 1;
    state.fruitReserve -= 1;
    placed.push(level);
  }
  if (placed.length > 0) {
    pushLog(state, `第 ${state.round} 回合：掷骰 [${rolls.join(', ')}]，果实放到第 ${placed.join('、')} 层`);
  } else {
    pushLog(state, `第 ${state.round} 回合：掷骰 [${rolls.join(', ')}]，无果实上架`);
  }
}

export function pushLog(state: GameState, text: string): void {
  state.log.push({ round: state.round, text });
}

/**
 * 计分移动（§4.9）：先累计本轮得分，再一次移动，停下后检查奖励格（不连锁）。
 * 到达 FINISH 立即获胜并中断结算。
 */
export function awardAndMove(state: GameState, color: ColorId, gained: Partial<Record<PointType, number>>): void {
  const p = playerOf(state, color);
  let steps = 0;
  for (const t of ['fruit', 'fight', 'mana'] as const) {
    const n = gained[t] ?? 0;
    if (n > 0) {
      p.roundPoints[t] += n;
      steps += n;
    }
  }
  if (steps <= 0) return;
  moveWithBonus(state, p, steps);
}

function moveWithBonus(state: GameState, p: PlayerState, steps: number): void {
  p.trackPos += steps;
  if (checkWin(state, p)) return;
  const space = TRACK[p.trackPos];
  if (space?.bonus && space.value && p.roundPoints[space.bonus] > 0) {
    pushLog(state, `${p.color} 停在 ${space.bonus} 奖励格，额外前进 ${space.value} 格`);
    p.trackPos += space.value;
    checkWin(state, p);
  }
}

function checkWin(state: GameState, p: PlayerState): boolean {
  if (p.trackPos >= LAST_SPACE) {
    p.trackPos = LAST_SPACE;
    state.winner = p.color;
    state.phase = 'finished';
    pushLog(state, `${p.color} 到达终点，获胜！`);
    return true;
  }
  return false;
}

/** 树上某层的角色占用（color + card）。 */
export interface Occupant {
  color: ColorId;
  card: CharacterCard;
}

/** 按本轮打出的角色牌构建树上占用，下标 0 = 第 1 层。 */
export function buildTree(state: GameState): Occupant[][] {
  const tree: Occupant[][] = Array.from({ length: TREE_LEVELS }, () => []);
  for (const p of state.players) {
    for (const c of state.playedCards[p.color] ?? []) {
      if (isCharacter(c)) tree[c - 1]?.push({ color: p.color, card: c });
    }
  }
  return tree;
}
