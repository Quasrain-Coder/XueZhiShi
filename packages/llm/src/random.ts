import type { Action, ColorId, GameState } from '@xzs/engine';
import type { PlayerAgent } from './index.js';

export class RandomAgent implements PlayerAgent {
  readonly name = 'random';
  async chooseAction(_state: GameState, legal: Action[], _seat: ColorId): Promise<Action> {
    const a = legal[Math.floor(Math.random() * legal.length)];
    if (!a) throw new Error('no legal action');
    return a;
  }
}
