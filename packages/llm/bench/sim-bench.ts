// 对局基准：
//   npx tsx bench/sim-bench.ts [games] [samples] [mode]
//   mode: vs-heuristic（默认） | selfplay（自对局多样性） | ab（新旧配置同场对抗）
// 环境变量 XZS_BENCH_TEMP 可对比不同温度（0.01 ≈ 纯 argmax）。
import { agentViewFor, applyAction, enumerateActions, newGame, isCharacter, type Action, type ColorId, type GameState } from '@xzs/engine';
import { HeuristicAgent, SimulationAgent, type PlayerAgent } from '../src/index.js';

const SEATS: ColorId[] = ['red', 'blue', 'yellow', 'gray'];

interface GameStat {
  winner: ColorId | null;
  ms: number;
  decisions: number;
  rounds: number;
  /** 同回合 ≥2 家出同一张角色牌的回合数（含战术性群架）。 */
  collideRounds: number;
  /** 同回合全部 AI 出同一张角色牌的回合数（机器人同质化指标）。 */
  allSameRounds: number;
  playedRounds: number;
}

async function playGame(agents: Record<ColorId, PlayerAgent>, seed: number): Promise<GameStat> {
  let s: GameState = newGame(SEATS, seed);
  let decisions = 0;
  let collideRounds = 0;
  let allSameRounds = 0;
  let playedRounds = 0;
  let lastRound = 1;
  const roundCards = new Map<number, number>();
  const t0 = Date.now();
  const record = (a: Action) => {
    if (a.type === 'submit-card' && isCharacter(a.card)) {
      roundCards.set(a.card, (roundCards.get(a.card) ?? 0) + 1);
    }
  };
  while (s.phase !== 'finished' && decisions < 800) {
    const legal = enumerateActions(s);
    if (legal.length === 0) throw new Error('卡死');
    const seat = legal[0]!.player;
    const a = await agents[seat]!.chooseAction(agentViewFor(s, seat), legal.filter((x) => x.player === seat), seat);
    if (s.phase === 'submit') record(a);
    if (s.round !== lastRound) {
      // 回合推进：结算上回合的同质化指标
      settleRound();
      lastRound = s.round;
    }
    s = applyAction(s, a);
    decisions++;
  }
  settleRound();
  function settleRound(): void {
    if (roundCards.size === 0) return;
    playedRounds++;
    if ([...roundCards.values()].some((n) => n >= 2)) collideRounds++;
    if (roundCards.size === 1) allSameRounds++;
    roundCards.clear();
  }
  return { winner: s.winner, ms: Date.now() - t0, decisions, rounds: s.round, collideRounds, allSameRounds, playedRounds };
}

const games = Number(process.argv[2] ?? 20);
const samples = Number(process.argv[3] ?? 120);
const mode = process.argv[4] ?? 'vs-heuristic';
const temp = Number(process.env.XZS_BENCH_TEMP ?? 4);

let wins = 0;
let totalMs = 0;
let totalDecisions = 0;
let totalRounds = 0;
let totalCollide = 0;
let totalAllSame = 0;
let totalPlayed = 0;
// ab 模式：A = 旧配置（单步/无终局权重）；B 由 XZS_AB_B 指定（both|leader|lookahead）
const bOpts =
  process.env.XZS_AB_B === 'leader'
    ? { lookahead: false, leaderAware: true }
    : process.env.XZS_AB_B === 'lookahead'
      ? { lookahead: true, leaderAware: false }
      : {};
const mkA = () => new SimulationAgent(samples, temp, 6, { lookahead: false, leaderAware: false });
const mkB = () => new SimulationAgent(samples, temp, 6, bOpts);
for (let i = 0; i < games; i++) {
  const sim = new SimulationAgent(samples, temp);
  const agents: Record<ColorId, PlayerAgent> =
    mode === 'selfplay'
      ? { red: sim, blue: new SimulationAgent(samples, temp), yellow: sim, gray: new SimulationAgent(samples, temp) }
      : mode === 'ab'
        ? i % 2 === 0
            ? {
                // A（旧：单步/无终局权重）坐 red/yellow，B（新配置）坐 blue/gray
                red: mkA(),
                yellow: mkA(),
                blue: mkB(),
                gray: mkB(),
              }
            : {
                // 交换座次消除结算顺序偏差
                red: mkB(),
                yellow: mkB(),
                blue: mkA(),
                gray: mkA(),
              }
        : i % 2 === 0
          ? { red: sim, yellow: sim, blue: new HeuristicAgent(), gray: new HeuristicAgent() }
          : { red: new HeuristicAgent(), yellow: new HeuristicAgent(), blue: sim, gray: sim };
  const stat = await playGame(agents, 1000 + i * 37);
  totalMs += stat.ms;
  totalDecisions += stat.decisions;
  totalRounds += stat.rounds;
  totalCollide += stat.collideRounds;
  totalAllSame += stat.allSameRounds;
  totalPlayed += stat.playedRounds;
  const mine: ColorId[] =
    mode === 'ab'
      ? i % 2 === 0 ? ['blue', 'gray'] : ['red', 'yellow']
      : mode === 'selfplay' ? SEATS : i % 2 === 0 ? ['red', 'yellow'] : ['blue', 'gray'];
  if (stat.winner && mine.includes(stat.winner)) wins++;
  console.log(
    `game ${i + 1}/${games}: winner=${stat.winner} ${stat.ms}ms ${stat.rounds}回合 撞层${stat.collideRounds}`,
  );
}
console.log(`\n[mode=${mode} T=${temp} samples=${samples}${mode === 'ab' ? ' B=' + JSON.stringify(bOpts) : ''}]`);
if (mode === 'ab') {
  console.log(`新配置（前瞻+终局权重）胜率: ${wins}/${games} = ${((wins / games) * 100).toFixed(0)}%`);
} else if (mode !== 'selfplay') {
  console.log(`SimulationAgent 胜率: ${wins}/${games} = ${((wins / games) * 100).toFixed(0)}%`);
} else {
  console.log(
    `自对局：撞层率 ${totalCollide}/${totalPlayed} = ${((totalCollide / totalPlayed) * 100).toFixed(0)}%，` +
      `全同质率 ${totalAllSame}/${totalPlayed} = ${((totalAllSame / totalPlayed) * 100).toFixed(0)}%`,
  );
}
console.log(`平均 ${(totalMs / totalDecisions).toFixed(1)}ms/决策，${(totalMs / games / 1000).toFixed(1)}s/局`);
