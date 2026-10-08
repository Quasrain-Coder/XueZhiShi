import type { ClientMessage, RoomInfo, ServerMessage, ViewState } from '@xzs/protocol';

export type Screen =
  | { name: 'home' }
  | { name: 'lobby'; room: RoomInfo }
  | { name: 'game'; room: RoomInfo; state: ViewState };

type Listener = () => void;

/** 全局连接存储（轻量，免引状态库）。 */
class NetStore {
  ws: WebSocket | null = null;
  room: RoomInfo | null = null;
  state: ViewState | null = null;
  seq = 0;
  error: string | null = null;
  connected = false;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  connect(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.error = null;
      this.emit();
      // 自动重连
      const saved = localStorage.getItem('xzs-session');
      if (saved) {
        const { code, token } = JSON.parse(saved) as { code: string; token: string };
        this.send({ type: 'rejoin', code, token });
      }
    };
    ws.onclose = () => {
      this.connected = false;
      this.emit();
      setTimeout(() => this.connect(), 1500);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      this.onMessage(msg);
    };
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'credentials':
        localStorage.setItem('xzs-session', JSON.stringify({ code: msg.code, token: msg.token }));
        break;
      case 'room-state':
        this.room = msg.room;
        if (!msg.room.started) this.state = null;
        break;
      case 'state-snapshot':
        this.state = msg.state;
        this.seq = msg.seq;
        if (this.room) this.room.started = true;
        break;
      case 'error':
        this.error = msg.message;
        break;
      case 'action-applied':
      case 'pong':
        break;
    }
    this.emit();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  leave(): void {
    localStorage.removeItem('xzs-session');
    location.reload();
  }
}

export const net = new NetStore();
