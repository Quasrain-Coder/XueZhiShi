import { describe, expect, it } from 'vitest';
import { applyAction, enumerateActions, newGame, playerOf, type CardId, type ColorId } from '@xzs/engine';
import { HeuristicAgent, SimulationAgent, boltzmannPick, personaBias, type PlayerAgent } from '../src/index.js';

const SEATS: ColorId[] = ['red', 'blue', 'yellow', 'gray'];

async function playGame(agents: Partial<Record<ColorId, PlayerAgent>>, seed: number, maxSteps = 800) {
  let s = newGame(SEATS, seed);
  let steps = 0;
  while (s.phase !== 'finished' && steps < maxSteps) {
    const legal = enumerateActions(s);
    if (legal.length === 0) throw new Error('卡死：无合法行动');
    const seat = legal[0]!.player;
    const a = await agents[seat]!.chooseAction(s, legal.filter((x) => x.player === seat), seat);
    s = applyAction(s, a);
    steps++;
  }
  return s;
}

describe('boltzmannPick / 多样性', () => {
  it('等价候选随种子发散，明显最优不受影响', () => {
    const tied = ['a', 'b', 'c'].map((tag) => ({ value: 10, tag }));
    const picks = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((s) => boltzmannPick(tied, s * 7919).tag));
    expect(picks.size).toBeGreaterThan(1); // 打破对称

    const clear = [{ value: 100, tag: 'best' }, { value: 0, tag: 'x' }, { value: -50, tag: 'y' }];
    for (let s = 0; s < 10; s++) {
      expect(boltzmannPick(clear, s * 7919).tag).toBe('best'); // margin 保护最优
    }
  });

  it('温度 → 0 退化为 argmax', () => {
    const items = [{ value: 10, tag: 'best' }, { value: 9, tag: 'a' }, { value: 9.5, tag: 'b' }];
    for (let s = 0; s < 10; s++) expect(boltzmannPick(items, s * 7919, 0.01).tag).toBe('best');
  });

  it('座位性格幅度有限且恒定', () => {
    const colors = ['red', 'blue', 'yellow', 'gray', 'pink'] as const;
    let nonzero = 0;
    for (const c of colors) {
      for (const card of [1, 2, 3, 4, 5, 6, 7] as CardId[]) {
        const b = personaBias(c, card);
        expect(Math.abs(b)).toBeLessThanOrEqual(0.8);
        if (b !== 0) nonzero++;
      }
    }
    expect(nonzero).toBeGreaterThan(0);
    expect(personaBias('red', 'healer')).toBe(0);
  });

  it('同一局面下不同座位/不同局面选择出现分化', async () => {
    // 4 张等价候选（同层无果无对手），温度下应至少两个回合内出现不同选择
    const agent = new SimulationAgent(30);
    const seen = new Set<string>();
    for (let round = 0; round < 4; round++) {
      const s = newGame(['red', 'blue', 'yellow', 'gray'], 5);
      s.round = round + 1;
      s.treeFruit = [0, 0, 0, 0, 0, 0, 0];
      for (const p of s.players) p.hand = [3, 4, 5, 6];
      for (const seat of ['red', 'blue', 'yellow', 'gray'] as ColorId[]) {
        const a = await agent.chooseAction(
          s,
          enumerateActions(s).filter((x) => x.player === seat),
          seat,
        );
        if (a.type === 'submit-card') seen.add(String(a.card));
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('SimulationAgent', () => {
  it('返回合法行动', async () => {
    const s = newGame(SEATS, 11);
    const agent = new SimulationAgent(30);
    const a = await agent.chooseAction(s, enumerateActions(s), 'red');
    expect(enumerateActions(s).some((x) => JSON.stringify(x) === JSON.stringify(a))).toBe(true);
  });

  it('确定性：同种子同行动', async () => {
    const agent = new SimulationAgent(30);
    const s = newGame(SEATS, 11);
    const a1 = await agent.chooseAction(s, enumerateActions(s), 'red');
    const a2 = await agent.chooseAction(s, enumerateActions(s), 'red');
    expect(a1).toEqual(a2);
  });

  it('能看见明显的杀招（Watcher 追加精确收割）', async () => {
    // red 出 watcher；blue 独上 5 层且 5 层有 3 果实 → red 应追加 6 击败 blue 拿果实
    let s = newGame(['red', 'blue'], 21);
    s.treeFruit = [0, 0, 0, 0, 3, 0, 0];
    playerOf(s, 'red').hand = ['watcher', 6, 1];
    playerOf(s, 'blue').hand = [5];
    s = applyAction(s, { type: 'submit-card', player: 'red', card: 'watcher' });
    s = applyAction(s, { type: 'submit-card', player: 'blue', card: 5 });
    expect(s.phase).toBe('watcher');
    const agent = new SimulationAgent(20);
    const a = await agent.chooseAction(
      s,
      enumerateActions(s).filter((x) => x.player === 'red'),
      'red',
    );
    expect(a).toEqual({ type: 'watcher-play', player: 'red', card: 6 });
  });

  it('完整自对局收敛', async () => {
    const agents = Object.fromEntries(SEATS.map((c) => [c, new SimulationAgent(30)]));
    const s = await playGame(agents, 5);
    expect(s.phase).toBe('finished');
    expect(s.winner).not.toBeNull();
  }, 60000);

  it('对阵启发式占优（10 局胜率）', async () => {
    let simWins = 0;
    const N = 6;
    for (let i = 0; i < N; i++) {
      const sim = new SimulationAgent(40);
      const heu = new HeuristicAgent();
      // sim 坐 red/yellow，heu 坐 blue/gray
      const agents = { red: sim, yellow: sim, blue: heu, gray: heu };
      const s = await playGame(agents, 1000 + i * 37);
      if (s.winner === 'red' || s.winner === 'yellow') simWins++;
    }
    console.log(`SimulationAgent 胜率 ${simWins}/${N}`);
    expect(simWins).toBeGreaterThan(N / 2);
  }, 240000);
});
