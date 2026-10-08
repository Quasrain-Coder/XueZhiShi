import type { Action, ColorId, GameState } from '@xzs/engine';

/**
 * AI 玩家接口：只做「选择」，规则合法性永远由引擎裁决。
 */
export interface PlayerAgent {
  readonly name: string;
  chooseAction(state: GameState, legal: Action[], seat: ColorId): Promise<Action>;
}

export { RandomAgent } from './random.js';
export { HeuristicAgent } from './heuristic.js';
export { ClaudeAgent } from './claude.js';
