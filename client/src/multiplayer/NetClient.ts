import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServer,
  GameEvent,
  JoinResult,
  MatchEnd,
  MatchStart,
  RoomConfig,
  RoomState,
  ServerToClient,
  Snapshot,
  InputCmd,
} from '@nullpoint/shared';

type GameSocket = Socket<ServerToClient, ClientToServer>;

export interface NetHandlers {
  room?: (s: RoomState) => void;
  matchStart?: (m: MatchStart) => void;
  matchEnd?: (m: MatchEnd) => void;
  snap?: (s: Snapshot) => void;
  events?: (e: GameEvent[]) => void;
  connection?: (state: 'connected' | 'reconnecting' | 'disconnected') => void;
  kicked?: (reason: string) => void;
}

const TOKEN_KEY = 'nullpoint.session';

/**
 * Conexão com o servidor: salas, sincronização de relógio, ping e reconexão automática.
 * O token de sessão fica no sessionStorage (por aba), então duas abas = dois jogadores distintos.
 */
export class NetClient {
  readonly socket: GameSocket;
  handlers: NetHandlers = {};
  playerId = -1;
  room: RoomState | null = null;
  rtt = 0;
  private offset = 0; // serverTime - performance.now()
  private offsetSamples: { rtt: number; offset: number }[] = [];
  private pingTimer = 0;
  private hadConnection = false;

  constructor(url = window.location.origin) {
    this.socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
    this.socket.on('connect', () => {
      this.handlers.connection?.('connected');
      this.burstPing();
      if (this.hadConnection && this.token) {
        this.rejoin().then((r) => {
          if (!r.ok) this.clearSession();
        });
      }
      this.hadConnection = true;
    });
    this.socket.on('disconnect', (reason) => {
      console.warn('[net] desconectado:', reason);
      this.handlers.connection?.(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
    });
    this.socket.on('room:state', (s) => {
      this.room = s;
      this.handlers.room?.(s);
    });
    this.socket.on('match:start', (m) => this.handlers.matchStart?.(m));
    this.socket.on('match:end', (m) => this.handlers.matchEnd?.(m));
    this.socket.on('snap', (s) => this.handlers.snap?.(s));
    this.socket.on('ev', (e) => this.handlers.events?.(e));
    this.socket.on('kicked', (r) => this.handlers.kicked?.(r));
    this.pingTimer = window.setInterval(() => this.ping(), 2000);
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  get token(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private saveSession(r: JoinResult): JoinResult {
    if (r.ok) {
      this.playerId = r.playerId!;
      this.room = r.room!;
      try {
        sessionStorage.setItem(TOKEN_KEY, r.token!);
      } catch {
        /* sem armazenamento: reconexão indisponível */
      }
    }
    return r;
  }

  clearSession(): void {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignora */
    }
  }

  waitConnected(timeout = 8000): Promise<void> {
    if (this.socket.connected) return Promise.resolve();
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Não foi possível conectar ao servidor.')), timeout);
      this.socket.once('connect', () => {
        clearTimeout(t);
        res();
      });
    });
  }

  private call<T>(fn: (cb: (r: T) => void) => void, timeout = 6000): Promise<T> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('O servidor não respondeu.')), timeout);
      fn((r) => {
        clearTimeout(t);
        res(r);
      });
    });
  }

  async create(name: string): Promise<JoinResult> {
    await this.waitConnected();
    return this.saveSession(await this.call<JoinResult>((cb) => this.socket.emit('room:create', { name }, cb)));
  }

  async join(name: string, code: string): Promise<JoinResult> {
    await this.waitConnected();
    return this.saveSession(await this.call<JoinResult>((cb) => this.socket.emit('room:join', { name, code }, cb)));
  }

  async rejoin(): Promise<JoinResult> {
    const token = this.token;
    if (!token) return { ok: false, error: 'Sem sessão.' };
    await this.waitConnected();
    return this.saveSession(await this.call<JoinResult>((cb) => this.socket.emit('room:rejoin', { token }, cb)));
  }

  start(): Promise<{ ok: boolean; error?: string }> {
    return this.call((cb) => this.socket.emit('room:start', cb));
  }

  configure(patch: Partial<RoomConfig>): void {
    this.socket.emit('room:config', patch);
  }

  endMatch(): void {
    this.socket.emit('room:end');
  }

  leave(): void {
    this.socket.emit('room:leave');
    this.clearSession();
    this.room = null;
    this.playerId = -1;
  }

  sendInput(cmds: InputCmd[]): void {
    if (this.socket.connected && cmds.length) this.socket.emit('input', cmds);
  }

  // ---- Relógio ----
  /** Estimativa do relógio do servidor (ms). */
  serverNow(): number {
    return performance.now() + this.offset;
  }

  private burstPing(): void {
    for (let i = 0; i < 5; i++) setTimeout(() => this.ping(), i * 120);
  }

  private ping(): void {
    if (!this.socket.connected) return;
    const t0 = performance.now();
    this.socket.emit('net:ping', { t: t0, rtt: Math.round(this.rtt) }, (serverTime) => {
      const t1 = performance.now();
      const rtt = t1 - t0;
      this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
      this.offsetSamples.push({ rtt, offset: serverTime + rtt / 2 - t1 });
      if (this.offsetSamples.length > 8) this.offsetSamples.shift();
      // A amostra com menor RTT tem a menor incerteza.
      const best = this.offsetSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      const first = this.offsetSamples.length === 1;
      this.offset = first ? best.offset : this.offset + (best.offset - this.offset) * 0.25;
    });
  }

  dispose(): void {
    clearInterval(this.pingTimer);
    this.socket.close();
  }
}
