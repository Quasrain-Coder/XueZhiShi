import type { Action, ColorId, GameState } from '@xzs/engine';

/** 座位类型：人类或 AI。 */
export type SeatKind = 'human' | 'heuristic' | 'llm';

export interface SeatInfo {
  color: ColorId;
  kind: SeatKind;
  nickname: string;
  connected: boolean;
}

export interface RoomInfo {
  code: string;
  seats: SeatInfo[];
  /** 创建者（可开始游戏）。 */
  host: ColorId | null;
  started: boolean;
  finished: boolean;
  winner: ColorId | null;
}

/**
 * 座位视角的游戏状态：隐藏本轮未齐的暗扣牌。
 * 手牌构成本身公开可推算（见 rules-reference §5），不做过滤。
 */
export type ViewState = GameState & {
  /** 你的主座位（第一个颜色）。 */
  you: ColorId | null;
  /** 你控制的全部座位（2 人变体一人两色）。 */
  yours: ColorId[];
};

// ---------- 上行（客户端 → 服务器） ----------

export type ClientMessage =
  | { type: 'create-room'; nickname: string; seats: number }
  | { type: 'join-room'; code: string; nickname: string }
  | { type: 'rejoin'; code: string; token: string }
  | { type: 'set-seat-kind'; color: ColorId; kind: SeatKind }
  | { type: 'claim-seat'; color: ColorId }
  | { type: 'start-game' }
  | { type: 'submit-action'; action: Action }
  | { type: 'ping' };

// ---------- 下行（服务器 → 客户端） ----------

export type ServerMessage =
  | { type: 'credentials'; code: string; color: ColorId; token: string }
  | { type: 'room-state'; room: RoomInfo }
  | { type: 'state-snapshot'; seq: number; state: ViewState }
  | { type: 'action-applied'; seq: number; action: Action }
  | { type: 'error'; reason: string; message: string }
  | { type: 'pong' };
