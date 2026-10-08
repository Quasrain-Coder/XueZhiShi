import { COLORS, type Action, type ColorId, type GameState, applyAction, enumerateActions, newGame } from '@xzs/engine';
import type { RoomInfo, SeatInfo, SeatKind, ViewState } from '@xzs/protocol';
import { ClaudeAgent, HeuristicAgent, type PlayerAgent } from '@xzs/llm';
import { randomBytes } from 'node:crypto';
import type { GameStore } from './db.js';

export interface Client {
  id: string;
  send(msg: unknown): void;
}

interface Seat {
  color: ColorId;
  kind: SeatKind;
  nickname: string;
  /** 控制该座位的客户端（可多色同人）。 */
  clientId: string | null;
  token: string;
  connected: boolean;
}

export class Room {
  readonly code: string;
  seats: Seat[] = [];
  hostClientId: string;
  state: GameState | null = null;
  seq = 0;
  gameId: number | null = null;
  private agents = new Map<ColorId, PlayerAgent>();

  constructor(
    code: string,
    colorCount: number,
    hostClient: Client,
    hostNickname: string,
    private store: GameStore,
  ) {
    this.code = code;
    this.hostClientId = hostClient.id;
    const colors = COLORS.slice(0, colorCount);
    this.seats = colors.map((color, i) => ({
      color,
      kind: 'human' as SeatKind,
      nickname: i === 0 ? hostNickname : '',
      clientId: i === 0 ? hostClient.id : null,
      token: randomBytes(16).toString('hex'),
      connected: i === 0,
    }));
  }

  info(): RoomInfo {
    return {
      code: this.code,
      seats: this.seats.map<SeatInfo>((s) => ({
        color: s.color,
        kind: s.kind,
        nickname: s.nickname,
        connected: s.connected,
      })),
      host: this.seats.find((s) => s.clientId === this.hostClientId)?.color ?? null,
      started: this.state !== null,
      finished: this.state?.phase === 'finished',
      winner: this.state?.winner ?? null,
    };
  }

  seatOf(clientId: string): Seat[] {
    return this.seats.filter((s) => s.clientId === clientId);
  }

  join(client: Client, nickname: string): Seat {
    const seat = this.seats.find((s) => s.kind === 'human' && s.clientId === null);
    if (!seat) throw new Error('房间已满');
    seat.clientId = client.id;
    seat.nickname = nickname;
    seat.connected = true;
    return seat;
  }

  rejoin(client: Client, token: string): Seat {
    const seat = this.seats.find((s) => s.token === token);
    if (!seat) throw new Error('凭据无效');
    seat.clientId = client.id;
    seat.connected = true;
    return seat;
  }

  claim(client: Client, color: ColorId): Seat {
    if (!this.seatOf(client.id).length) throw new Error('你不在此房间');
    const seat = this.seats.find((s) => s.color === color);
    if (!seat) throw new Error('座位不存在');
    if (seat.kind !== 'human' || seat.clientId !== null) throw new Error('座位已被占用');
    seat.clientId = client.id;
    seat.connected = true;
    return seat;
  }

  setKind(clientId: string, color: ColorId, kind: SeatKind): void {
    if (clientId !== this.hostClientId) throw new Error('只有房主可以设置座位');
    if (this.state) throw new Error('对局已开始');
    const seat = this.seats.find((s) => s.color === color);
    if (!seat) throw new Error('座位不存在');
    if (seat.clientId !== null && kind !== 'human') throw new Error('座位已被认领，不能改为 AI');
    seat.kind = kind;
    if (kind !== 'human') seat.nickname = kind === 'llm' ? 'Claude' : 'AI';
    if (kind === 'human') seat.nickname = '';
  }

  start(clientId: string): void {
    if (clientId !== this.hostClientId) throw new Error('只有房主可以开始');
    if (this.state) throw new Error('对局已开始');
    const unclaimed = this.seats.filter((s) => s.kind === 'human' && s.clientId === null);
    if (unclaimed.length > 0) throw new Error('有空的人类座位，请先认领或改为 AI');
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.state = newGame(
      this.seats.map((s) => s.color),
      seed,
    );
    this.gameId = this.store.createGame(this.code, seed, this.seats.map((s) => s.color));
    for (const s of this.seats) {
      this.store.saveSeat(this.gameId, s.color, s.nickname || s.color, s.token);
      if (s.kind === 'heuristic') this.agents.set(s.color, new HeuristicAgent());
      if (s.kind === 'llm') {
        try {
          this.agents.set(s.color, new ClaudeAgent());
        } catch {
          this.agents.set(s.color, new HeuristicAgent());
          s.kind = 'heuristic';
          s.nickname = 'AI';
        }
      }
    }
  }

  /** 应用一个行动（人类或 AI），返回是否成功。 */
  apply(color: ColorId, action: Action): void {
    if (!this.state) throw new Error('对局未开始');
    if (action.player !== color) throw new Error('不能操作其他座位');
    this.state = applyAction(this.state, action);
    this.seq += 1;
    if (this.gameId !== null) this.store.appendAction(this.gameId, this.seq, color, action);
    if (this.state.phase === 'finished' && this.state.winner && this.gameId !== null) {
      this.store.finishGame(this.gameId, this.state.winner, this.state);
    }
  }

  /** 驱动 AI 座位直到没有 AI 待决行动。 */
  async driveAi(): Promise<void> {
    if (!this.state) return;
    for (let guard = 0; guard < 200 && this.state.phase !== 'finished'; guard++) {
      const legal = enumerateActions(this.state);
      if (legal.length === 0) return;
      const aiColors = new Set([...this.agents.keys()]);
      const aiAction = legal.find((a) => aiColors.has(a.player));
      if (!aiAction) return; // 等待人类
      const agent = this.agents.get(aiAction.player)!;
      const seatLegal = legal.filter((a) => a.player === aiAction.player);
      let action: Action;
      try {
        action = await agent.chooseAction(this.state, seatLegal, aiAction.player);
      } catch {
        action = await new HeuristicAgent().chooseAction(this.state, seatLegal, aiAction.player);
      }
      try {
        this.apply(aiAction.player, action);
      } catch {
        // AI 返回非法行动：降级为第一个合法行动
        this.apply(aiAction.player, seatLegal[0]!);
      }
    }
  }

  /** 座位视角过滤：隐藏本轮未亮开的暗扣牌与 watcher 追加牌。 */
  viewFor(clientId: string | null): ViewState {
    if (!this.state) throw new Error('对局未开始');
    const mine = new Set(this.seatOf(clientId ?? '').map((s) => s.color));
    const view = JSON.parse(JSON.stringify(this.state)) as ViewState;
    view.you = clientId ? (this.seatOf(clientId)[0]?.color ?? null) : null;
    view.yours = clientId ? this.seatOf(clientId).map((s) => s.color) : [];
    if (!view.revealed) {
      for (const c of Object.keys(view.submissions) as ColorId[]) {
        if (!mine.has(c)) view.submissions[c] = 'healer'; // 占位，前端只显示「已暗扣」
      }
    }
    if (view.phase === 'watcher') {
      for (const c of Object.keys(view.watcherCards) as ColorId[]) {
        if (!mine.has(c)) delete view.watcherCards[c];
      }
    }
    return view;
  }
}

export class RoomManager {
  rooms = new Map<string, Room>();

  constructor(private store: GameStore) {}

  create(hostClient: Client, nickname: string, colorCount: number): Room {
    const count = Math.min(5, Math.max(2, colorCount));
    let code = '';
    do {
      code = randomBytes(3).toString('hex').toUpperCase();
    } while (this.rooms.has(code));
    const room = new Room(code, count, hostClient, nickname, this.store);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new Error('房间不存在');
    return room;
  }
}
