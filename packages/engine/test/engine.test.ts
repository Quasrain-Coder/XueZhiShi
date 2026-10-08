import { describe, expect, it } from 'vitest';
import {
  type Action,
  type CardId,
  type ColorId,
  type GameState,
  LAST_SPACE,
  applyAction,
  enumerateActions,
  newGame,
  playerOf,
} from '../src/index.js';

const SEATS: ColorId[] = ['red', 'blue', 'yellow'];

/** 构造一个手牌/果实可控的局面。 */
function setup(hands: Partial<Record<ColorId, CardId[]>>, fruit: Partial<Record<number, number>> = {}): GameState {
  const s = newGame(SEATS, 42);
  s.treeFruit = [0, 0, 0, 0, 0, 0, 0];
  s.fruitReserve = 15;
  for (const [lv, n] of Object.entries(fruit)) s.treeFruit[Number(lv) - 1] = n ?? 0;
  for (const p of s.players) {
    p.hand = hands[p.color] ?? [];
    p.discard = [];
    p.usedSpecials = [];
  }
  return s;
}

function submitAll(s: GameState, cards: Partial<Record<ColorId, CardId>>): GameState {
  for (const p of s.players) {
    s = applyAction(s, { type: 'submit-card', player: p.color, card: cards[p.color]! });
  }
  return s;
}

describe('newGame / 放果实', () => {
  it('初始状态：10 张手牌、位置 0、回合 1、已放果实', () => {
    const s = newGame(SEATS, 1);
    expect(s.players).toHaveLength(3);
    for (const p of s.players) {
      expect(p.hand).toHaveLength(10);
      expect(p.trackPos).toBe(0);
    }
    expect(s.round).toBe(1);
    expect(s.phase).toBe('submit');
    const onTree = s.treeFruit.reduce((a, b) => a + b, 0);
    expect(onTree).toBe(2);
    expect(s.fruitReserve).toBe(13);
    expect(s.treeFruit[6]).toBe(0); // 第 7 层永不放果实
  });

  it('储备为 0 不放果实', () => {
    const s = newGame(SEATS, 1);
    s.fruitReserve = 0;
    s.treeFruit = [0, 0, 0, 0, 0, 0, 0];
    const before = [...s.treeFruit];
    // 直接调内部：打完整回合后 reserve 仍 0 时新回合不放
    expect(before.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('基本回合', () => {
  it('各上各层：拿果实 + 最低者得法力 + 角色回手', () => {
    let s = setup({ red: [6, 'healer'], blue: [4, 'healer'], yellow: [2, 'healer'] }, { 6: 2, 4: 1 });
    s = submitAll(s, { red: 6, blue: 4, yellow: 2 });
    expect(s.phase).toBe('submit'); // 无特殊牌待决，直接结算完进入下一回合
    expect(s.round).toBe(2);
    expect(playerOf(s, 'red').trackPos).toBe(2); // 2 果实
    expect(playerOf(s, 'blue').trackPos).toBe(1); // 1 果实
    expect(playerOf(s, 'yellow').trackPos).toBe(1); // 法力（最低）
    // 角色回手
    expect(playerOf(s, 'red').hand).toContain(6);
    expect(playerOf(s, 'blue').hand).toContain(4);
    expect(playerOf(s, 'yellow').hand).toContain(2);
    // 果实回储备 + 新回合放 2 个
    expect(s.treeFruit.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('同层互殴：全部坠树，各得 k-1 战斗分，果实留下', () => {
    let s = setup({ red: [5], blue: [5], yellow: [1] }, { 5: 2 });
    s = submitAll(s, { red: 5, blue: 5, yellow: 1 });
    expect(playerOf(s, 'red').trackPos).toBe(1);
    expect(playerOf(s, 'blue').trackPos).toBe(1);
    expect(playerOf(s, 'red').discard).toEqual([5]);
    expect(playerOf(s, 'blue').discard).toEqual([5]);
    expect(playerOf(s, 'yellow').trackPos).toBe(1); // 法力（树上只剩 yellow）
    expect(playerOf(s, 'yellow').hand).toContain(1);
  });

  it('规则书 p.5 示例：Marie(6) 击败 Vincent/Anna(5)，Hugo(4) 击败 Nina(3)', () => {
    const seats: ColorId[] = ['red', 'blue', 'yellow', 'gray', 'pink'];
    let s = newGame(seats, 7);
    s.treeFruit = [1, 0, 1, 0, 0, 3, 0]; // 1层1个 3层1个 6层3个（4层无果实）
    for (const p of s.players) p.hand = [1, 2, 3, 4, 5, 6, 7];
    s = submitAll(s, { red: 6, blue: 5, yellow: 5, gray: 4, pink: 3 });
    // Marie(red): 2 战斗 + 3 果实 = 5
    expect(playerOf(s, 'red').trackPos).toBe(5);
    expect(playerOf(s, 'red').discard).toEqual([]);
    expect(playerOf(s, 'red').hand).toContain(6);
    // Vincent(blue)/Anna(yellow) 坠树不得分
    expect(playerOf(s, 'blue').trackPos).toBe(0);
    expect(playerOf(s, 'blue').discard).toEqual([5]);
    expect(playerOf(s, 'yellow').discard).toEqual([5]);
    // Hugo(gray): 1 战斗（击败 Nina）+ 1 法力（最低）= 2
    expect(playerOf(s, 'gray').trackPos).toBe(2);
    expect(playerOf(s, 'gray').hand).toContain(4);
    // Nina(pink) 坠树不得分
    expect(playerOf(s, 'pink').trackPos).toBe(0);
    expect(playerOf(s, 'pink').discard).toEqual([3]);
    // 5 层果实没人拿会留下（示例中 5 层无果实的设定不同，这里 3/1 层果实随坠树留下）
    expect(s.treeFruit[2]).toBe(1); // 3 层果实仍在
    expect(s.treeFruit[0]).toBe(1); // 1 层无人，仍在
  });

  it('获救：上方敌人被更高层击败', () => {
    // red 在 7，blue 在 6，yellow/gray 在 5：red 先击败 blue，yellow/gray 互殴
    const seats: ColorId[] = ['red', 'blue', 'yellow', 'gray'];
    let s = newGame(seats, 3);
    s.treeFruit = [0, 0, 0, 0, 0, 0, 0];
    for (const p of s.players) p.hand = [5, 6, 7];
    s = submitAll(s, { red: 7, blue: 6, yellow: 5, gray: 5 });
    expect(playerOf(s, 'red').trackPos).toBe(2); // 击败 blue +1，独享树上再 +1 法力
    expect(playerOf(s, 'blue').discard).toEqual([6]);
    expect(playerOf(s, 'yellow').trackPos).toBe(1); // 互殴 k-1=1
    expect(playerOf(s, 'gray').trackPos).toBe(1);
  });
});

describe('特殊牌', () => {
  it('Blizzard：所有角色牌弃置，打出者按张数得分', () => {
    let s = setup({ red: ['blizzard'], blue: [5], yellow: [3] });
    s = submitAll(s, { red: 'blizzard', blue: 5, yellow: 3 });
    expect(playerOf(s, 'red').trackPos).toBe(2);
    expect(playerOf(s, 'red').usedSpecials).toEqual(['blizzard']);
    expect(playerOf(s, 'blue').discard).toEqual([5]);
    expect(playerOf(s, 'yellow').discard).toEqual([3]);
    expect(playerOf(s, 'blue').trackPos).toBe(0);
  });

  it('多人 Blizzard 都按全部弃牌数得分', () => {
    const seats: ColorId[] = ['red', 'blue', 'yellow'];
    let s = newGame(seats, 9);
    s.treeFruit = [0, 0, 0, 0, 0, 0, 0];
    for (const p of s.players) p.hand = p.color === 'yellow' ? [4] : ['blizzard'];
    s = submitAll(s, { red: 'blizzard', blue: 'blizzard', yellow: 4 });
    expect(playerOf(s, 'red').trackPos).toBe(1);
    expect(playerOf(s, 'blue').trackPos).toBe(1);
    expect(playerOf(s, 'yellow').discard).toEqual([4]);
  });

  it('Watcher：亮牌后追加一张', () => {
    let s = setup({ red: ['watcher', 6], blue: [5], yellow: [3] });
    s = applyAction(s, { type: 'submit-card', player: 'red', card: 'watcher' });
    s = applyAction(s, { type: 'submit-card', player: 'blue', card: 5 });
    s = applyAction(s, { type: 'submit-card', player: 'yellow', card: 3 });
    expect(s.phase).toBe('watcher');
    expect(s.pendingWatcher).toEqual(['red']);
    // 合法行动只有 red 的 watcher-play
    const acts = enumerateActions(s);
    expect(acts.every((a) => a.type === 'watcher-play' && a.player === 'red')).toBe(true);
    // red 看到 blue 在 5，上 6 击败之
    s = applyAction(s, { type: 'watcher-play', player: 'red', card: 6 });
    expect(playerOf(s, 'red').trackPos).toBe(1);
    expect(playerOf(s, 'blue').discard).toEqual([5]);
    expect(playerOf(s, 'red').usedSpecials).toEqual(['watcher']);
    expect(playerOf(s, 'red').hand).toContain(6);
  });

  it('Healer：回收至多 2 张弃牌', () => {
    let s = setup({ red: ['healer', 4], blue: [5], yellow: [3] });
    playerOf(s, 'red').discard = [1, 2, 7];
    s = submitAll(s, { red: 'healer', blue: 5, yellow: 3 });
    expect(s.phase).toBe('healer');
    expect(s.pendingHealer).toEqual(['red']);
    // 非法：回收 3 张
    expect(() => applyAction(s, { type: 'healer-recover', player: 'red', cards: [1, 2, 7] })).toThrow();
    // 非法：弃牌堆没有的牌
    expect(() => applyAction(s, { type: 'healer-recover', player: 'red', cards: [4] })).toThrow();
    s = applyAction(s, { type: 'healer-recover', player: 'red', cards: [2, 7] });
    expect(s.phase).toBe('submit');
    const red = playerOf(s, 'red');
    expect(red.hand).toContain(2);
    expect(red.hand).toContain(7);
    expect(red.hand).toContain('healer'); // Healer 回手
    expect(red.discard).toEqual([1]);
  });

  it('Healer 打光手牌 → 全部回收', () => {
    let s = setup({ red: ['healer'], blue: [5], yellow: [3] });
    playerOf(s, 'red').discard = [1, 2, 6, 7];
    s = submitAll(s, { red: 'healer', blue: 5, yellow: 3 });
    // 无需决策，直接进入下一回合
    expect(s.phase).toBe('submit');
    const red = playerOf(s, 'red');
    expect(red.discard).toEqual([]);
    for (const c of [1, 2, 6, 7, 'healer'] as CardId[]) expect(red.hand).toContain(c);
  });

  it('Blizzard 不能弃 Healer；Healer 不能回收本轮 Blizzard 弃牌', () => {
    let s = setup({ red: ['healer', 4], blue: ['blizzard'], yellow: [3] });
    playerOf(s, 'red').discard = [1, 2];
    s = applyAction(s, { type: 'submit-card', player: 'red', card: 'healer' });
    s = applyAction(s, { type: 'submit-card', player: 'blue', card: 'blizzard' });
    s = applyAction(s, { type: 'submit-card', player: 'yellow', card: 3 });
    expect(s.phase).toBe('healer');
    // red 只能回收 [1,2] 中的（yellow 的 3 尚未进 red 弃牌堆）
    s = applyAction(s, { type: 'healer-recover', player: 'red', cards: [1, 2] });
    const red = playerOf(s, 'red');
    expect(red.hand).toContain('healer');
    expect(playerOf(s, 'yellow').discard).toEqual([3]);
    expect(playerOf(s, 'blue').trackPos).toBe(1);
  });
});

describe('奖励格与胜利', () => {
  it('停在对应类型奖励格且本轮得过该类分 → 额外前进（不连锁）', () => {
    let s = setup({ red: [6, 'healer'], blue: [4, 'healer'], yellow: [2, 'healer'] }, { 6: 2 });
    playerOf(s, 'red').trackPos = 1; // +2 果实 → 3 = Mana+1，但只有果实分，不触发
    playerOf(s, 'blue').trackPos = 6; // +1 法力? blue 在4层不是最低（yellow在2）→ blue 0 分
    s = submitAll(s, { red: 6, blue: 4, yellow: 2 });
    expect(playerOf(s, 'red').trackPos).toBe(3); // 1+2=3，Mana 格但无 Mana 分 → 不触发
    expect(playerOf(s, 'yellow').trackPos).toBe(1); // 法力 1
  });

  it('战斗分触发 Fight 奖励格（复现规则书 Marie 例子：位置 3 +5 → Fight+2 → +2）', () => {
    // 加 gray 在 1 层垫底，避免 red 额外吃到法力分
    const seats: ColorId[] = ['red', 'blue', 'yellow', 'gray'];
    let s = newGame(seats, 5);
    s.treeFruit = [0, 0, 0, 0, 0, 3, 0];
    for (const p of s.players) p.hand = [1, 5, 6];
    playerOf(s, 'red').trackPos = 3;
    s = submitAll(s, { red: 6, blue: 5, yellow: 5, gray: 1 });
    // 3 + (2 战斗 + 3 果实) = 8 = Fight+2，本轮有战斗分 → +2 = 10
    expect(playerOf(s, 'red').trackPos).toBe(10);
    expect(playerOf(s, 'gray').trackPos).toBe(1); // 法力
  });

  it('到达 FINISH 立即获胜，后续得分不再结算', () => {
    let s = setup({ red: [7], blue: [6], yellow: [1] }, { 6: 3 });
    playerOf(s, 'red').trackPos = LAST_SPACE - 1; // +果实? red 在 7 层无果实，但击败 blue 得 1 → 到终点
    s = submitAll(s, { red: 7, blue: 6, yellow: 1 });
    expect(s.winner).toBe('red');
    expect(s.phase).toBe('finished');
    expect(playerOf(s, 'red').trackPos).toBe(LAST_SPACE);
    // blue/yellow 不再结算法力等
    expect(playerOf(s, 'yellow').trackPos).toBe(0);
  });
});

describe('枚举与确定性', () => {
  it('submit 阶段枚举所有未出牌座位的手牌', () => {
    const s = setup({ red: [1, 'healer'], blue: [2], yellow: [3] });
    const acts = enumerateActions(s);
    expect(acts).toHaveLength(2 + 1 + 1);
  });

  it('非法行动抛 RulesError', () => {
    const s = setup({ red: [1], blue: [2], yellow: [3] });
    expect(() => applyAction(s, { type: 'submit-card', player: 'red', card: 5 })).toThrow(/手牌/);
    const s2 = applyAction(s, { type: 'submit-card', player: 'red', card: 1 });
    expect(() => applyAction(s2, { type: 'submit-card', player: 'red', card: 1 })).toThrow(/已出牌/);
  });

  it('重放逐字节一致', () => {
    const play = () => {
      let s = newGame(SEATS, 123);
      const script: Action[] = [
        { type: 'submit-card', player: 'red', card: 6 },
        { type: 'submit-card', player: 'blue', card: 5 },
        { type: 'submit-card', player: 'yellow', card: 5 },
        { type: 'submit-card', player: 'red', card: 1 },
        { type: 'submit-card', player: 'blue', card: 2 },
        { type: 'submit-card', player: 'yellow', card: 7 },
      ];
      for (const a of script) s = applyAction(s, a);
      return JSON.stringify(s);
    };
    expect(play()).toBe(play());
  });

  it('applyAction 不修改原状态', () => {
    const s = setup({ red: [1], blue: [2], yellow: [3] });
    const snapshot = JSON.stringify(s);
    applyAction(s, { type: 'submit-card', player: 'red', card: 1 });
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
