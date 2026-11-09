import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, GameEvent, InputCmd, JoinResult, RoomState, ServerToClient, Snapshot } from '@nullpoint/shared';

export type TestSocket = Socket<ServerToClient, ClientToServer>;

/** Cliente de teste: uma conexão Socket.IO real, idêntica à do navegador. */
export class TestClient {
  socket: TestSocket;
  snaps: Snapshot[] = [];
  events: GameEvent[] = [];
  room: RoomState | null = null;
  playerId = -1;
  token = '';
  seq = 0;

  constructor(url: string) {
    this.socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.socket.on('snap', (s) => this.snaps.push(s));
    this.socket.on('ev', (e) => this.events.push(...e));
    this.socket.on('room:state', (r) => (this.room = r));
  }

  connected(): Promise<void> {
    return new Promise((res, rej) => {
      if (this.socket.connected) return res();
      this.socket.once('connect', () => res());
      this.socket.once('connect_error', rej);
    });
  }

  private handle(r: JoinResult): JoinResult {
    if (r.ok) {
      this.playerId = r.playerId!;
      this.token = r.token!;
      this.room = r.room!;
    }
    return r;
  }

  create(name: string): Promise<JoinResult> {
    return new Promise((res) => this.socket.emit('room:create', { name }, (r) => res(this.handle(r))));
  }
  join(name: string, code: string): Promise<JoinResult> {
    return new Promise((res) => this.socket.emit('room:join', { name, code }, (r) => res(this.handle(r))));
  }
  rejoin(token: string): Promise<JoinResult> {
    return new Promise((res) => this.socket.emit('room:rejoin', { token }, (r) => res(this.handle(r))));
  }
  start(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((res) => this.socket.emit('room:start', res));
  }

  get last(): Snapshot | undefined {
    return this.snaps[this.snaps.length - 1];
  }

  cmd(buttons: number, yaw: number, pitch = 0): InputCmd {
    return { seq: this.seq++, buttons, yaw, pitch, viewTime: this.last?.t ?? 0 };
  }

  send(cmds: InputCmd[]): void {
    this.socket.emit('input', cmds);
  }

  /** Envia comandos em tempo real (2 por lote a cada ~33 ms), como o cliente do jogo. */
  async play(ticks: number, fn: (i: number) => { buttons: number; yaw: number; pitch?: number }): Promise<void> {
    for (let i = 0; i < ticks; i += 2) {
      const batch: InputCmd[] = [];
      for (let j = i; j < Math.min(ticks, i + 2); j++) {
        const c = fn(j);
        batch.push(this.cmd(c.buttons, c.yaw, c.pitch ?? 0));
      }
      this.send(batch);
      await sleep(1000 / 30);
    }
  }

  close(): void {
    this.socket.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => T | undefined | null | false, timeout = 5000, label = 'condição'): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`Tempo esgotado aguardando ${label}`);
    await sleep(15);
  }
}
