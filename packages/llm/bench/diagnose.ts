// AI 行为诊断：自对局统计得分来源、特殊牌使用、回合节奏
// npx tsx bench/diagnose.ts [games] [samples]
import { agentViewFor, applyAction, enumerateActions, newGame, type ColorId, type GameState } from '@xzs/engine';
import { SimulationAgent, type PlayerAgent } from '../src/index.js';

const SEATS: ColorId[] = ['red', 'blue', 'yellow', 'gray'];
const games = Number(process.argv[2] ?? 6);
const samples = Number(process.argv[3] ?? 80);

const stats = {
  fruit: 0, fight: 0, mana: 0, blizzardPts: 0,
  watcher: 0, blizzard: 0, healer: 0,
  surviveRounds: 0, totalRounds: 0, falls: 0,
};

async function run(seed: number) {
  const agents: Record<ColorId, PlayerAgent> = {};
  for (const c of SEATS) agents[c] = new SimulationAgent(samples);
  let s: GameState = newGame(SEATS, seed);
  let decisions = 0;
  while (s.phase !== 'finished' && decisions < 800) {
    const legal = enumerateActions(s);
    const seat = legal[0]!.player;
    const a = await agents[seat]!.chooseAction(agentViewFor(s, seat), legal.filter((x) => x.player === seat), seat);
    if (a.type === 'submit-card' && a.card === 'watcher') stats.watcher++;
    if (a.type === 'submit-card' && a.card === 'blizzard') stats.blizzard++;
    if (a.type === 'submit-card' && a.card === 'healer') stats.healer++;
    s = applyAction(s, a);
    decisions++;
  }
  stats.totalRounds += s.round;
  return s;
}

for (let i = 0; i < games; i++) {
  const s = await run(500 + i * 61);
  for (const e of s.log) {
    if (e.text.includes('个果实')) stats.fruit++;
    if (e.text.includes('法力分')) stats.mana++;
    if (e.text.includes('击败')) stats.fight++;
    if (e.text.includes('互殴')) stats.falls++;
    if (e.text.includes('Blizzard')) stats.blizzardPts++;
  }
  console.log(`game ${i + 1}: winner=${s.winner} rounds=${s.round} scores=${s.players.map((p) => p.color + '=' + p.trackPos).join(' ')}`);
}
console.log(`\n[${games} 局合计] 果实得分事件:${stats.fruit} 战斗:${stats.fight} 法力:${stats.mana} Blizzard分:${stats.blizzardPts}`);
console.log(`特殊牌使用: watcher:${stats.watcher} blizzard:${stats.blizzard} healer:${stats.healer}（每局每座位各 1/1/无限）`);
console.log(`互殴事件:${stats.falls} 总回合:${stats.totalRounds}`);
