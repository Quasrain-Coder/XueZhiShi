import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enumerateActions } from '@xzs/engine';
import { GameStore } from '../src/db.js';
import { RoomManager, type Client } from '../src/rooms.js';

let dir: string;
let store: GameStore;
let manager: RoomManager;

function fakeClient(id: string): Client & { msgs: unknown[] } {
  return { id, msgs: [], send(m: unknown) { this.msgs.push(m); } };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xzs-test-'));
  store = new GameStore(dir);
  manager = new RoomManager(store);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Room', () => {
  it('创建/加入/开始/AI 驱动到结束', async () => {
    const host = fakeClient('h1');
    const room = manager.create(host, '房主', 3);
    expect(room.seats).toHaveLength(3);
    // 两个空人类座位改 AI
    room.setKind(host.id, room.seats[1]!.color, 'heuristic');
    room.setKind(host.id, room.seats[2]!.color, 'llm'); // 无 key → 降级 heuristic
    room.start(host.id);
    expect(room.state).not.toBeNull();
    expect(room.seats[2]!.kind).toBe('heuristic');

    // 人类 + AI 打完一整局
    for (let guard = 0; guard < 500 && room.state!.phase !== 'finished'; guard++) {
      await room.driveAi();
      const legal = enumerateActions(room.state!);
      const myColor = room.seats[0]!.color;
      const mine = legal.find((a) => a.player === myColor);
      if (!mine) {
        // 人类无待决但 AI 有 → 已在 driveAi 处理；都不动则卡死检测
        const any = legal[0];
        expect(any, '不应卡死').toBeUndefined();
        break;
      }
      room.apply(myColor, mine);
    }
    expect(room.state!.phase).toBe('finished');
    expect(room.state!.winner).not.toBeNull();
    // 落库检查
    const games = store.listGames();
    expect(games).toHaveLength(1);
    expect(games[0]!.winner).toBe(room.state!.winner);
  }, 30000);

  it('断线重连凭 token 找回座位', () => {
    const host = fakeClient('h1');
    const room = manager.create(host, '房主', 2);
    const guest = fakeClient('g1');
    const seat = room.join(guest, '客人');
    // 断线
    for (const s of room.seatOf(guest.id)) s.connected = false;
    const back = fakeClient('g2');
    const rejoined = room.rejoin(back, seat.token);
    expect(rejoined.color).toBe(seat.color);
    expect(() => room.rejoin(fakeClient('x'), 'bad-token')).toThrow();
  });

  it('一人认领两色（2 人变体）', () => {
    const host = fakeClient('h1');
    const room = manager.create(host, '房主', 4);
    const guest = fakeClient('g1');
    room.join(guest, '客人');
    const extra = room.claim(guest, room.seats[2]!.color);
    expect(room.seatOf(guest.id).map((s) => s.color)).toContain(extra.color);
    expect(room.seatOf(guest.id)).toHaveLength(2);
    // 第四座改 AI 后即可开始
    room.setKind(host.id, room.seats[3]!.color, 'heuristic');
    room.start(host.id);
    expect(room.state!.players).toHaveLength(4);
  });

  it('视图过滤：未亮牌前其他座位暗扣被隐藏', () => {
    const host = fakeClient('h1');
    const room = manager.create(host, '房主', 2);
    const guest = fakeClient('g1');
    room.join(guest, '客人');
    room.start(host.id);
    const myColor = room.seats[0]!.color;
    room.apply(myColor, { type: 'submit-card', player: myColor, card: 5 });
    const hostView = room.viewFor(host.id);
    const guestView = room.viewFor(guest.id);
    expect(hostView.submissions[myColor]).toBe(5); // 自己可见
    expect(guestView.submissions[myColor]).not.toBe(5); // 他人只见占位
    expect(guestView.revealed).toBe(false);
  });

  it('空人类座位不能开始', () => {
    const host = fakeClient('h1');
    const room = manager.create(host, '房主', 3);
    expect(() => room.start(host.id)).toThrow(/空的人类座位/);
  });
});
