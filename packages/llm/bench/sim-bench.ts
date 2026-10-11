// 对局基准：SimulationAgent vs HeuristicAgent 胜率 + 单决策耗时。
// 用法：npx tsx bench/sim-bench.ts [局数] [采样数]
import { applyAction, enumerateActions, newGame, type ColorId, type GameState } from '@xzs/engine';
import { HeuristicAgent, SimulationAgent, type PlayerAgent } from '../src/index.js';

const SEATS: ColorId[] = ['red', 'blue', 'yellow', 'gray'];

async function playGame(agents: Record<ColorId, PlayerAgent>, seed: number): Promise<{ winner: ColorId | null; ms: number; decisions: number }> {
  let s: GameState = newGame(SEATS, seed);
  let decisions = 0;
  const t0 = Date.now();
  while (s.phase !== 'finished' && decisions < 800) {
    const legal = enumerateActions(s);
    if (legal.length === 0) throw new Error('卡死');
    const seat = legal[0]!.player;
    const a = await agents[seat]!.chooseAction(s, legal.filter((x) => x.player === seat), seat);
    s = applyAction(s, a);
    decisions++;
  }
  return { winner: s.winner, ms: Date.now() - t0, decisions };
}

const games = Number(process.argv[2] ?? 20);
const samples = Number(process.argv[3] ?? 120);
let simWins = 0;
let totalMs = 0;
let totalDecisions = 0;
for (let i = 0; i < games; i++) {
  const sim = new SimulationAgent(samples);
  const heu = new HeuristicAgent();
  // 交替座次消除先手/座位偏差
  const agents: Record<ColorId, PlayerAgent> =
    i % 2 === 0
      ? { red: sim, yellow: sim, blue: heu, gray: heu }
      : { red: heu, yellow: heu, blue: sim, gray: sim };
  const { winner, ms, decisions } = await playGame(agents, 1000 + i * 37);
  totalMs += ms;
  totalDecisions += decisions;
  const simSeats: ColorId[] = i % 2 === 0 ? ['red', 'yellow'] : ['blue', 'gray'];
  if (winner && simSeats.includes(winner)) simWins++;
  console.log(`game ${i + 1}/${games}: winner=${winner} ${ms}ms`);
}
console.log(`\nSimulationAgent(${samples} 采样) 胜率: ${simWins}/${games} = ${((simWins / games) * 100).toFixed(0)}%`);
console.log(`平均 ${(totalMs / totalDecisions).toFixed(1)}ms/决策，${(totalMs / games / 1000).toFixed(1)}s/局`);
