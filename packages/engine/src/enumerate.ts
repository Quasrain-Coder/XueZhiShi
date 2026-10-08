import type { Action, CharacterCard, GameState } from './types.js';

/** 枚举当前全部合法行动（含座位）。 */
export function enumerateActions(state: GameState): Action[] {
  if (state.phase === 'finished') return [];
  const actions: Action[] = [];
  switch (state.phase) {
    case 'submit': {
      for (const p of state.players) {
        if (state.submissions[p.color] !== undefined) continue;
        for (const card of p.hand) {
          actions.push({ type: 'submit-card', player: p.color, card });
        }
      }
      return actions;
    }
    case 'watcher': {
      for (const color of state.pendingWatcher) {
        const p = state.players.find((pl) => pl.color === color);
        if (!p) continue;
        for (const card of p.hand) {
          actions.push({ type: 'watcher-play', player: color, card });
        }
      }
      return actions;
    }
    case 'healer': {
      for (const color of state.pendingHealer) {
        const p = state.players.find((pl) => pl.color === color);
        if (!p) continue;
        for (const cards of recoverCombos(p.discard)) {
          actions.push({ type: 'healer-recover', player: color, cards });
        }
      }
      return actions;
    }
  }
}

/** 弃牌堆的 0–2 张全部组合。 */
export function recoverCombos(discard: CharacterCard[]): CharacterCard[][] {
  const combos: CharacterCard[][] = [[]];
  for (let i = 0; i < discard.length; i++) {
    combos.push([discard[i]!]);
    for (let j = i + 1; j < discard.length; j++) {
      combos.push([discard[i]!, discard[j]!]);
    }
  }
  return combos;
}
