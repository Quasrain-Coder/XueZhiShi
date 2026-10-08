import { enumerateActions } from './enumerate.js';
import { awardAndMove, buildTree, placeFruit, playerOf, pushLog, type Occupant } from './state.js';
import {
  type Action,
  type CardId,
  type CharacterCard,
  type ColorId,
  type GameState,
  RulesError,
  isCharacter,
} from './types.js';

/** 纯函数推进：非法行动抛 RulesError。 */
export function applyAction(state: GameState, action: Action): GameState {
  // 深拷贝，保持纯函数语义
  const next: GameState = JSON.parse(JSON.stringify(state)) as GameState;
  switch (action.type) {
    case 'submit-card':
      applySubmit(next, action.player, action.card);
      break;
    case 'watcher-play':
      applyWatcherPlay(next, action.player, action.card);
      break;
    case 'healer-recover':
      applyHealerRecover(next, action.player, action.cards);
      break;
  }
  return next;
}

function applySubmit(state: GameState, color: ColorId, card: CardId): void {
  if (state.phase !== 'submit') throw new RulesError('wrong-phase', `当前阶段 ${state.phase}，不能出牌`);
  if (state.submissions[color] !== undefined) throw new RulesError('already-submitted', `${color} 已出牌`);
  const p = playerOf(state, color);
  const idx = p.hand.findIndex((c) => c === card);
  if (idx < 0) throw new RulesError('card-not-in-hand', `手牌中没有 ${card}`);
  p.hand.splice(idx, 1);
  state.submissions[color] = card;

  if (Object.keys(state.submissions).length === state.players.length) {
    state.revealed = true;
    pushLog(
      state,
      `亮牌：${state.players.map((pl) => `${pl.color}=${cardName(state.submissions[pl.color]!)}`).join('，')}`,
    );
    // Watcher 追加出牌（§4.3）：有手牌才进入待决
    state.pendingWatcher = state.players
      .filter((pl) => state.submissions[pl.color] === 'watcher' && pl.hand.length > 0)
      .map((pl) => pl.color);
    if (state.pendingWatcher.length > 0) {
      state.phase = 'watcher';
    } else {
      enterHealerPhase(state);
    }
  }
}

function applyWatcherPlay(state: GameState, color: ColorId, card: CardId): void {
  if (state.phase !== 'watcher') throw new RulesError('wrong-phase', `当前阶段 ${state.phase}，不能 Watcher 追加`);
  if (!state.pendingWatcher.includes(color)) throw new RulesError('not-pending', `${color} 无需 Watcher 追加`);
  const p = playerOf(state, color);
  const idx = p.hand.findIndex((c) => c === card);
  if (idx < 0) throw new RulesError('card-not-in-hand', `手牌中没有 ${card}`);
  p.hand.splice(idx, 1);
  state.watcherCards[color] = card;
  state.pendingWatcher = state.pendingWatcher.filter((c) => c !== color);
  pushLog(state, `${color} 的 Watcher 追加：${cardName(card)}`);
  if (state.pendingWatcher.length === 0) {
    enterHealerPhase(state);
  }
}

/** 汇总本轮打出的牌（含 Watcher 追加），进入 Healer 回收阶段（§4.4）。 */
function enterHealerPhase(state: GameState): void {
  const played: Partial<Record<ColorId, CardId[]>> = {};
  for (const p of state.players) {
    const cards: CardId[] = [];
    const sub = state.submissions[p.color];
    if (sub !== undefined) cards.push(sub);
    const extra = state.watcherCards[p.color];
    if (extra !== undefined) cards.push(extra);
    if (cards.length > 0) played[p.color] = cards;
  }
  state.playedCards = played;

  state.pendingHealer = [];
  for (const p of state.players) {
    const cards = played[p.color] ?? [];
    if (!cards.includes('healer')) continue;
    if (p.discard.length === 0) continue; // 无牌可回收
    if (p.hand.length === 0) {
      // 特例：打光手牌出 Healer → 全部回收（§4.4）
      pushLog(state, `${p.color} 打光手牌出 Healer，回收全部弃牌 [${p.discard.join(', ')}]`);
      p.hand.push(...p.discard);
      p.discard = [];
    } else {
      state.pendingHealer.push(p.color);
    }
  }
  if (state.pendingHealer.length > 0) {
    state.phase = 'healer';
  } else {
    resolveRound(state);
  }
}

function applyHealerRecover(state: GameState, color: ColorId, cards: CharacterCard[]): void {
  if (state.phase !== 'healer') throw new RulesError('wrong-phase', `当前阶段 ${state.phase}，不能 Healer 回收`);
  if (!state.pendingHealer.includes(color)) throw new RulesError('not-pending', `${color} 无需 Healer 回收`);
  if (cards.length > 2) throw new RulesError('too-many', 'Healer 至多回收 2 张');
  const p = playerOf(state, color);
  const pool = [...p.discard];
  for (const c of cards) {
    const idx = pool.indexOf(c);
    if (idx < 0) throw new RulesError('card-not-in-discard', `弃牌堆中没有 ${c}`);
    pool.splice(idx, 1);
  }
  for (const c of cards) {
    p.discard.splice(p.discard.indexOf(c), 1);
    p.hand.push(c);
  }
  if (cards.length > 0) pushLog(state, `${color} 的 Healer 回收 [${cards.join(', ')}]`);
  state.pendingHealer = state.pendingHealer.filter((c) => c !== color);
  if (state.pendingHealer.length === 0) {
    resolveRound(state);
  }
}

/** 回合结算（§4.5–§4.10）。 */
function resolveRound(state: GameState): void {
  const played = state.playedCards;
  const blizzardPlayers = state.players.filter((p) => (played[p.color] ?? []).includes('blizzard'));

  if (blizzardPlayers.length > 0) {
    // Blizzard：本轮所有角色牌弃置，每位 Blizzard 玩家按全部弃牌数得战斗分（§4.5）
    let discarded = 0;
    for (const p of state.players) {
      const chars = (played[p.color] ?? []).filter(isCharacter);
      for (const c of chars) {
        p.discard.push(c);
        discarded += 1;
      }
      if (chars.length > 0) {
        played[p.color] = (played[p.color] ?? []).filter((c) => !isCharacter(c));
      }
    }
    pushLog(state, `Blizzard！${discarded} 张角色牌被吹落`);
    for (const bp of blizzardPlayers) {
      pushLog(state, `${bp.color} 因 Blizzard 得 ${discarded} 战斗分`);
      awardAndMove(state, bp.color, { fight: discarded });
      if (state.winner) break;
    }
    return finishRound(state, []);
  }

  // 战斗 + 果实：从 7 层到 1 层逐层（§4.6/§4.7）
  const tree = buildTree(state);
  for (let level = 7; level >= 1; level--) {
    const occ = tree[level - 1]!;
    const gained = new Map<ColorId, { fight: number; fruit: number }>();
    const bump = (color: ColorId, key: 'fight' | 'fruit', n: number) => {
      const g = gained.get(color) ?? { fight: 0, fruit: 0 };
      g[key] += n;
      gained.set(color, g);
    };

    if (occ.length >= 2) {
      // 同层互殴：全部坠树，每人按其他被弃角色数得分
      pushLog(state, `第 ${level} 层 ${occ.map((o) => o.color).join('、')} 互殴，全部坠树`);
      for (const o of occ) {
        bump(o.color, 'fight', occ.length - 1);
        playerOf(state, o.color).discard.push(o.card);
      }
      tree[level - 1] = [];
    } else if (occ.length === 1) {
      const solo = occ[0]!;
      const below = tree[level - 2] as Occupant[] | undefined;
      if (below && below.length >= 1) {
        pushLog(state, `第 ${level} 层 ${solo.color} 击败第 ${level - 1} 层 ${below.map((o) => o.color).join('、')}`);
        bump(solo.color, 'fight', below.length);
        for (const o of below) playerOf(state, o.color).discard.push(o.card);
        tree[level - 2] = [];
      }
      // 幸存者拿本层全部果实
      const fruit = state.treeFruit[level - 1] ?? 0;
      if (fruit > 0) {
        bump(solo.color, 'fruit', fruit);
        state.treeFruit[level - 1] = 0;
        state.fruitReserve += fruit;
        pushLog(state, `${solo.color} 拿走第 ${level} 层 ${fruit} 个果实`);
      }
    }

    // 同层得分合并为一次移动，按座位顺序
    for (const p of state.players) {
      const g = gained.get(p.color);
      if (g) {
        awardAndMove(state, p.color, g);
        if (state.winner) return finishRound(state, survivorsOf(tree));
      }
    }
  }

  // 法力：树上最低角色得 1 分（§4.8）
  for (let level = 1; level <= 7; level++) {
    const occ = tree[level - 1]!;
    if (occ.length === 1) {
      pushLog(state, `${occ[0]!.color} 是树上最低角色，得 1 法力分`);
      awardAndMove(state, occ[0]!.color, { mana: 1 });
      if (state.winner) return finishRound(state, survivorsOf(tree));
      break;
    }
  }

  finishRound(state, survivorsOf(tree));
}

function survivorsOf(tree: Occupant[][]): Occupant[] {
  return tree.flat();
}

/** 回合收尾（§4.10）：幸存角色与 Healer 回手；watcher/blizzard 入永久弃牌区。 */
function finishRound(state: GameState, survivors: Occupant[]): void {
  if (state.winner === null) {
    for (const p of state.players) {
      for (const c of state.playedCards[p.color] ?? []) {
        if (isCharacter(c)) {
          if (survivors.some((o) => o.color === p.color && o.card === c)) {
            p.hand.push(c);
          }
          // 其余角色牌已在结算时进入弃牌堆
        } else if (c === 'healer') {
          p.hand.push('healer');
        } else {
          p.usedSpecials.push(c);
        }
      }
    }
  }
  state.submissions = {};
  state.watcherCards = {};
  state.playedCards = {};
  state.pendingWatcher = [];
  state.pendingHealer = [];
  for (const p of state.players) p.roundPoints = { fruit: 0, fight: 0, mana: 0 };
  if (state.winner) {
    state.phase = 'finished';
    return;
  }
  state.round += 1;
  state.phase = 'submit';
  state.revealed = false;
  placeFruit(state);
}

export function cardName(card: CardId): string {
  if (isCharacter(card)) return `角色 ${card}`;
  return { healer: 'Healer', watcher: 'Watcher', blizzard: 'Blizzard' }[card];
}

/** 供测试/复盘：断言行动合法（不推进）。 */
export function isLegal(state: GameState, action: Action): boolean {
  return enumerateActions(state).some((a) => JSON.stringify(a) === JSON.stringify(action));
}
