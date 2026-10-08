import { TRACK, isCharacter, type Action, type CardId, type ColorId, type GameState } from '@xzs/engine';
import type { PlayerAgent } from './index.js';

/**
 * Claude LLM AI：结构化局势摘要 + 候选行动列表，tool use 强制返回候选编号。
 * 非法 → 重试一次 → 仍非法抛错（由服务器降级 Heuristic）。
 */
export class ClaudeAgent implements PlayerAgent {
  readonly name = 'claude';
  private model: string;
  private apiKey: string;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY ?? '', model = process.env.XZS_LLM_MODEL ?? 'claude-sonnet-4-5') {
    this.apiKey = apiKey;
    this.model = model;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY 未配置');
  }

  async chooseAction(state: GameState, legal: Action[], seat: ColorId): Promise<Action> {
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const idx = await this.ask(state, legal, seat, lastError);
      const chosen = idx !== null ? legal[idx] : undefined;
      if (chosen) return chosen;
      lastError = '你返回了无效编号，请严格返回候选列表中的编号。';
    }
    throw new Error('ClaudeAgent 连续返回无效行动');
  }

  private async ask(state: GameState, legal: Action[], seat: ColorId, lastError: string): Promise<number | null> {
    const candidates = legal.map((a, i) => `${i}. ${describeAction(a)}`).join('\n');
    const user = `${summarize(state, seat)}

当前需要你（${seat}）决策，候选行动：
${candidates}
${lastError}
调用 choose 工具返回你选择的编号和一句理由。`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 300,
        system:
          '你在玩桌游《雪之时》。规则：在树 1-7 层出牌争果实；同层互殴全灭；独处者击败正下一层所有人；回合末树上最低者得 1 法力分；果实/战斗/法力都是分数，先到计分轨终点胜。特殊牌：Healer 回收至多 2 张弃牌；Watcher 亮牌后追加一张；Blizzard 掀掉本轮所有角色牌并按张数得分。根据局势选择最优行动。',
        messages: [{ role: 'user', content: user }],
        tools: [
          {
            name: 'choose',
            description: '选择候选行动编号',
            input_schema: {
              type: 'object',
              properties: {
                index: { type: 'integer', description: '候选行动编号' },
                reason: { type: 'string', description: '一句理由' },
              },
              required: ['index', 'reason'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'choose' },
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      content?: { type: string; input?: { index?: number } }[];
    };
    const tool = data.content?.find((c) => c.type === 'tool_use');
    const idx = tool?.input?.index;
    return typeof idx === 'number' && idx >= 0 && idx < legal.length ? idx : null;
  }
}

export function describeAction(a: Action): string {
  switch (a.type) {
    case 'submit-card':
      return `打出 ${cardText(a.card)}`;
    case 'watcher-play':
      return `Watcher 追加打出 ${cardText(a.card)}`;
    case 'healer-recover':
      return a.cards.length > 0 ? `Healer 回收 [${a.cards.join(', ')}]` : 'Healer 不回收';
  }
}

function cardText(c: CardId): string {
  if (isCharacter(c)) return `角色牌 ${c}（上第 ${c} 层）`;
  return { healer: 'Healer（回收弃牌）', watcher: 'Watcher（追加出牌）', blizzard: 'Blizzard（掀桌得分）' }[c];
}

export function summarize(state: GameState, seat: ColorId): string {
  const lines: string[] = [];
  lines.push(`第 ${state.round} 回合，阶段：${state.phase}。你的座位：${seat}。`);
  lines.push(
    `计分轨（终点 ${TRACK.length - 1}）：${state.players.map((p) => `${p.color}=${p.trackPos}`).join('，')}`,
  );
  const fruit = state.treeFruit.map((n, i) => (n > 0 ? `${i + 1}层×${n}` : null)).filter(Boolean).join('，');
  lines.push(`树上果实：${fruit || '无'}（储备 ${state.fruitReserve}）`);
  if (state.lastDice.length > 0) lines.push(`本回合骰子：[${state.lastDice.join(', ')}]`);
  for (const p of state.players) {
    const mine = p.color === seat;
    lines.push(
      `${p.color}${mine ? '（你）' : ''}：手牌 [${p.hand.join(', ')}]，弃牌 [${p.discard.join(', ')}]，已用特殊 [${p.usedSpecials.join(', ')}]`,
    );
  }
  if (state.revealed) {
    lines.push(
      `本轮已亮牌：${state.players.map((p) => `${p.color}=${String(state.submissions[p.color] ?? '?')}`).join('，')}`,
    );
  }
  return lines.join('\n');
}
