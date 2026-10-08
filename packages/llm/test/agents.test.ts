import { describe, expect, it } from 'vitest';
import { applyAction, enumerateActions, newGame, type ColorId } from '@xzs/engine';
import { HeuristicAgent, RandomAgent } from '../src/index.js';

const SEATS: ColorId[] = ['red', 'blue', 'yellow', 'gray'];

describe('agents', () => {
  it('RandomAgent 返回合法行动', async () => {
    const s = newGame(SEATS, 11);
    const agent = new RandomAgent();
    const a = await agent.chooseAction(s, enumerateActions(s), 'red');
    expect(enumerateActions(s).some((x) => JSON.stringify(x) === JSON.stringify(a))).toBe(true);
  });

  it('HeuristicAgent 优先抢果实多的层', async () => {
    const s = newGame(SEATS, 11);
    s.treeFruit = [0, 3, 0, 1, 0, 0, 0];
    const agent = new HeuristicAgent();
    const a = await agent.chooseAction(s, enumerateActions(s), 'red');
    expect(a).toEqual({ type: 'submit-card', player: 'red', card: 2 });
  });

  it('HeuristicAgent 完整自对局不卡死', async () => {
    let s = newGame(SEATS, 77);
    const agent = new HeuristicAgent();
    let steps = 0;
    while (s.phase !== 'finished' && steps < 500) {
      // 逐座位驱动：每次取一个有待决行动的座位
      const legal = enumerateActions(s);
      expect(legal.length).toBeGreaterThan(0);
      const seat = legal[0]!.player;
      const seatLegal = legal.filter((a) => a.player === seat);
      const a = await agent.chooseAction(s, seatLegal, seat);
      s = applyAction(s, a);
      steps++;
    }
    expect(s.phase).toBe('finished');
    expect(s.winner).not.toBeNull();
    expect(s.round).toBeGreaterThan(3);
  }, 20000);
});
