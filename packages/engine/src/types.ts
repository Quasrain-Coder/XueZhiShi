/** 玩家颜色（座位）。 */
export const COLORS = ['blue', 'pink', 'yellow', 'gray', 'red'] as const;
export type ColorId = (typeof COLORS)[number];

/** 角色牌 1-7 或特殊牌。 */
export type CharacterCard = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type SpecialCard = 'healer' | 'watcher' | 'blizzard';
export type CardId = CharacterCard | SpecialCard;

export const CHARACTER_CARDS: readonly CharacterCard[] = [1, 2, 3, 4, 5, 6, 7];
export const SPECIAL_CARDS: readonly SpecialCard[] = ['healer', 'watcher', 'blizzard'];

export function isCharacter(card: CardId): card is CharacterCard {
  return typeof card === 'number';
}

/** 得分类型。 */
export type PointType = 'fruit' | 'fight' | 'mana';
export type PointCounts = Record<PointType, number>;

export function emptyPoints(): PointCounts {
  return { fruit: 0, fight: 0, mana: 0 };
}

/** 计分轨格子。 */
export interface TrackSpace {
  /** 奖励类型；无则为普通格。 */
  bonus?: PointType;
  /** 奖励面值 1-3。 */
  value?: number;
  /** 起点格。 */
  start?: boolean;
  /** 终点格。 */
  finish?: boolean;
}

export interface PlayerState {
  color: ColorId;
  /** 手牌（可出）。 */
  hand: CardId[];
  /** 角色牌弃牌堆（面朝上，Healer 可回收）。 */
  discard: CharacterCard[];
  /** 永久弃牌区（用过的 watcher/blizzard）。 */
  usedSpecials: SpecialCard[];
  /** 计分轨位置 0..LAST_SPACE。 */
  trackPos: number;
  /** 本轮已得三类分（奖励格判定用，回合结束清零）。 */
  roundPoints: PointCounts;
}

export type Phase = 'submit' | 'watcher' | 'healer' | 'finished';

/** 回合事件（战报/复盘用）。 */
export interface LogEvent {
  round: number;
  text: string;
}

export interface GameState {
  /** mulberry32 状态。 */
  rngState: number;
  /** 初始种子（重放标识）。 */
  seed: number;
  round: number;
  players: PlayerState[];
  /** 各层果实数，下标 0 = 第 1 层 … 下标 6 = 第 7 层。 */
  treeFruit: number[];
  fruitReserve: number;
  phase: Phase;
  /** 本轮暗扣的牌（watcher 追加牌齐之前同样视为暗扣）。 */
  submissions: Partial<Record<ColorId, CardId>>;
  /** 出牌是否已全部亮开（所有座位提交完毕）。 */
  revealed: boolean;
  /** 待 Watcher 追加出牌的座位。 */
  pendingWatcher: ColorId[];
  watcherCards: Partial<Record<ColorId, CardId>>;
  /** 待 Healer 选择回收牌的座位。 */
  pendingHealer: ColorId[];
  /** 本轮打出的全部牌（结算用；含 watcher 追加）。结算后清空。 */
  playedCards: Partial<Record<ColorId, CardId[]>>;
  /** 本回合掷骰结果（战报展示）。 */
  lastDice: number[];
  winner: ColorId | null;
  log: LogEvent[];
}

export type Action =
  | { type: 'submit-card'; player: ColorId; card: CardId }
  | { type: 'watcher-play'; player: ColorId; card: CardId }
  | { type: 'healer-recover'; player: ColorId; cards: CharacterCard[] };

export class RulesError extends Error {
  constructor(
    public reason: string,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'RulesError';
  }
}
