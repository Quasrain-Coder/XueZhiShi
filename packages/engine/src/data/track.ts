import type { CardId, TrackSpace } from '../types.js';

/**
 * 计分轨布局：28 格（0 = START，27 = FINISH）。
 * 转录自规则书版图扫描件，见 docs/rules-reference.md §6。
 */
export const TRACK: readonly TrackSpace[] = [
  { start: true }, // 0
  {}, // 1
  {}, // 2
  { bonus: 'mana', value: 1 }, // 3
  { bonus: 'mana', value: 2 }, // 4
  { bonus: 'mana', value: 1 }, // 5
  {}, // 6
  { bonus: 'fight', value: 1 }, // 7
  { bonus: 'fight', value: 2 }, // 8
  {}, // 9
  { bonus: 'fruit', value: 1 }, // 10
  { bonus: 'fruit', value: 1 }, // 11
  { bonus: 'fruit', value: 2 }, // 12
  {}, // 13
  {}, // 14
  { bonus: 'mana', value: 1 }, // 15
  { bonus: 'mana', value: 2 }, // 16
  { bonus: 'mana', value: 3 }, // 17
  {}, // 18
  {}, // 19
  { bonus: 'fight', value: 2 }, // 20
  { bonus: 'fight', value: 1 }, // 21
  {}, // 22
  { bonus: 'fruit', value: 2 }, // 23
  { bonus: 'fruit', value: 1 }, // 24
  {}, // 25
  {}, // 26
  { finish: true }, // 27
];

export const LAST_SPACE = TRACK.length - 1;

export const TREE_LEVELS = 7;
export const FRUIT_TOTAL = 15;

export function startingDeck(): CardId[] {
  return [1, 2, 3, 4, 5, 6, 7, 'healer', 'watcher', 'blizzard'];
}
