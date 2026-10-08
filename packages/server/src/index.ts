import { WebSocketServer, type WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientMessage, ServerMessage } from '@xzs/protocol';
import { RoomManager, type Client } from './rooms.js';
import { GameStore } from './db.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = Number(process.env.XZS_PORT ?? 8787);
const DATA_DIR = process.env.XZS_DATA_DIR ?? join(REPO_ROOT, 'server-data');
const WEB_DIST = process.env.XZS_WEB_DIST ?? join(REPO_ROOT, 'packages/web/dist');

const store = new GameStore(DATA_DIR);
const manager = new RoomManager(store);

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** 单端口部署：同端口提供静态资源与 WS。 */
const http = createServer((req, res) => {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(404).end('web 未构建（npm run build -w @xzs/web）');
    return;
  }
  let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (path === '/') path = '/index.html';
  const file = normalize(join(WEB_DIST, path));
  const target = file.startsWith(normalize(WEB_DIST)) && existsSync(file) && statSync(file).isFile()
    ? file
    : join(WEB_DIST, 'index.html'); // SPA 回退
  try {
    const body = readFileSync(target);
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

interface WsClient extends Client {
  ws: WebSocket;
  roomCode: string | null;
}

const wss = new WebSocketServer({ server: http, path: '/ws' });
http.listen(PORT, () => {
  console.log(`[xzs] Snow Time server on http://0.0.0.0:${PORT} (ws: /ws)`);
});

wss.on('connection', (ws) => {
  const client: WsClient = {
    id: randomBytes(8).toString('hex'),
    roomCode: null,
    ws,
    send(msg: unknown) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return send(client, { type: 'error', reason: 'bad-json', message: '消息格式错误' });
    }
    void handle(client, msg).catch((err: unknown) => {
      send(client, {
        type: 'error',
        reason: 'server',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  });

  ws.on('close', () => {
    if (client.roomCode) {
      const room = manager.rooms.get(client.roomCode);
      if (room) {
        for (const s of room.seatOf(client.id)) s.connected = false;
        broadcastRoom(room);
      }
    }
  });
});

function send(client: Client, msg: ServerMessage): void {
  client.send(msg);
}

function broadcastRoom(room: ReturnType<RoomManager['get']>): void {
  const info = room.info();
  forEachClient(room, (c) => send(c, { type: 'room-state', room: info }));
}

function broadcastState(room: ReturnType<RoomManager['get']>): void {
  forEachClient(room, (c) => {
    send(c, { type: 'state-snapshot', seq: room.seq, state: room.viewFor(c.id) });
  });
}

const clientsByRoom = new Map<string, Set<WsClient>>();

function forEachClient(room: { code: string }, fn: (c: WsClient) => void): void {
  for (const c of clientsByRoom.get(room.code) ?? []) fn(c);
}

function attach(client: WsClient, code: string): void {
  client.roomCode = code;
  if (!clientsByRoom.has(code)) clientsByRoom.set(code, new Set());
  clientsByRoom.get(code)!.add(client);
}

async function handle(client: WsClient, msg: ClientMessage): Promise<void> {
  switch (msg.type) {
    case 'ping':
      return send(client, { type: 'pong' });

    case 'create-room': {
      const room = manager.create(client, msg.nickname || '玩家', msg.seats);
      attach(client, room.code);
      const seat = room.seats[0]!;
      send(client, { type: 'credentials', code: room.code, color: seat.color, token: seat.token });
      return broadcastRoom(room);
    }

    case 'join-room': {
      const room = manager.get(msg.code);
      if (room.state) throw new Error('对局已开始，请用重连');
      const seat = room.join(client, msg.nickname || '玩家');
      attach(client, room.code);
      send(client, { type: 'credentials', code: room.code, color: seat.color, token: seat.token });
      return broadcastRoom(room);
    }

    case 'rejoin': {
      const room = manager.get(msg.code);
      const seat = room.rejoin(client, msg.token);
      attach(client, room.code);
      send(client, { type: 'credentials', code: room.code, color: seat.color, token: seat.token });
      broadcastRoom(room);
      if (room.state) {
        send(client, { type: 'state-snapshot', seq: room.seq, state: room.viewFor(client.id) });
      }
      return;
    }

    case 'set-seat-kind': {
      const room = manager.get(mustRoom(client));
      room.setKind(client.id, msg.color, msg.kind);
      return broadcastRoom(room);
    }

    case 'claim-seat': {
      const room = manager.get(mustRoom(client));
      room.claim(client, msg.color);
      return broadcastRoom(room);
    }

    case 'start-game': {
      const room = manager.get(mustRoom(client));
      room.start(client.id);
      broadcastRoom(room);
      broadcastState(room);
      await room.driveAi();
      return broadcastState(room);
    }

    case 'submit-action': {
      const room = manager.get(mustRoom(client));
      const mine = new Set(room.seatOf(client.id).map((s) => s.color));
      if (!mine.has(msg.action.player)) throw new Error('这不是你的座位');
      room.apply(msg.action.player, msg.action);
      broadcastRoom(room);
      broadcastState(room);
      await room.driveAi();
      return broadcastState(room);
    }
  }
}

function mustRoom(client: WsClient): string {
  if (!client.roomCode) throw new Error('尚未加入房间');
  return client.roomCode;
}
