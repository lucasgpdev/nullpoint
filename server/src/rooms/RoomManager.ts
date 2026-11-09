import { randomBytes, randomInt } from 'node:crypto';
import {
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  sanitizeCode,
  sanitizeName,
  validateCmdBatch,
  validateConfigPatch,
  type JoinResult,
} from '@nullpoint/shared';
import type { Server } from 'socket.io';
import type { GameSocket, ServerPlayer } from '../players/ServerPlayer';
import { Room } from './Room';

interface SocketData {
  room?: Room;
  player?: ServerPlayer;
}

const EMPTY_ROOM_TTL_MS = 60_000;

/**
 * Gerencia salas privadas, entrada por código, reconexão e o loop global de simulação.
 */
export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly tokens = new Map<string, { room: Room; player: ServerPlayer }>();
  private idSeq = 1;
  private timer: NodeJS.Timeout | null = null;
  private last = performance.now();

  constructor(private readonly io: Server) {}

  start(): void {
    const TICK_MS = 1000 / 60;
    this.last = performance.now();
    this.timer = setInterval(() => {
      const nowPerf = performance.now();
      const elapsed = Math.min(250, nowPerf - this.last);
      this.last = nowPerf;
      const now = Date.now();
      for (const room of this.rooms.values()) {
        room.update(now, elapsed);
        if (room.players.size === 0 && now - room.lastActivity > EMPTY_ROOM_TTL_MS) this.deleteRoom(room);
        else if (room.players.size === 0 && room.phase !== 'lobby') room.end('players', null, now);
      }
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private deleteRoom(room: Room): void {
    for (const p of room.players.values()) this.tokens.delete(p.token);
    this.rooms.delete(room.code);
  }

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  private join(socket: GameSocket, room: Room, name: string): JoinResult {
    const token = randomBytes(18).toString('base64url');
    const player = room.addPlayer(socket, name, token, Date.now());
    this.tokens.set(token, { room, player });
    (socket.data as SocketData).room = room;
    (socket.data as SocketData).player = player;
    if (room.phase === 'playing') setImmediate(() => room.broadcastMatchStart(player));
    return { ok: true, playerId: player.id, token, room: room.state() };
  }

  private leaveCurrent(socket: GameSocket): void {
    const d = socket.data as SocketData;
    if (d.room && d.player) {
      d.room.remove(d.player.id);
      this.tokens.delete(d.player.token);
    }
    d.room = undefined;
    d.player = undefined;
  }

  attach(socket: GameSocket): void {
    const data = socket.data as SocketData;
    // Proteção antes de entrar em sala (o player ainda não existe).
    let preJoinBudget = 10;
    const guard = () => (data.player ? data.player.guard : null);
    const allowRoom = () => {
      const g = guard();
      if (g) return g.allow('room');
      return preJoinBudget-- > 0;
    };
    const kickIfNeeded = () => {
      const g = guard();
      if (g?.shouldKick) {
        socket.emit('kicked', 'Excesso de mensagens inválidas.');
        socket.disconnect(true);
      }
    };
    const ack = <T>(fn: unknown, value: T) => {
      if (typeof fn === 'function') fn(value);
    };

    socket.on('room:create', (p, cb) => {
      if (!allowRoom()) return ack(cb, { ok: false, error: 'Muitas tentativas. Aguarde.' });
      const name = sanitizeName(p?.name);
      if (!name) return ack(cb, { ok: false, error: 'Nome inválido (2 a 16 caracteres).' });
      this.leaveCurrent(socket);
      const room = new Room(this.newCode(), () => this.idSeq++);
      this.rooms.set(room.code, room);
      ack(cb, this.join(socket, room, name));
    });

    socket.on('room:join', (p, cb) => {
      if (!allowRoom()) return ack(cb, { ok: false, error: 'Muitas tentativas. Aguarde.' });
      const name = sanitizeName(p?.name);
      if (!name) return ack(cb, { ok: false, error: 'Nome inválido (2 a 16 caracteres).' });
      const code = sanitizeCode(p?.code);
      const room = code ? this.rooms.get(code) : undefined;
      if (!room) return ack(cb, { ok: false, error: 'Sala não encontrada. Confira o código.' });
      if (room.isFull) return ack(cb, { ok: false, error: 'A sala está cheia.' });
      this.leaveCurrent(socket);
      ack(cb, this.join(socket, room, name));
    });

    socket.on('room:rejoin', (p, cb) => {
      if (!allowRoom()) return ack(cb, { ok: false, error: 'Muitas tentativas.' });
      const entry = typeof p?.token === 'string' ? this.tokens.get(p.token) : undefined;
      if (!entry || !entry.room.players.has(entry.player.id)) return ack(cb, { ok: false, error: 'Sessão expirada.' });
      const { room, player } = entry;
      // Se a sessão antiga ainda estiver aberta (outra aba), ela é encerrada.
      if (player.socket && player.socket.id !== socket.id) player.socket.disconnect(true);
      room.reattach(player, socket);
      data.room = room;
      data.player = player;
      if (room.phase === 'playing') setImmediate(() => room.broadcastMatchStart(player));
      ack(cb, { ok: true, playerId: player.id, token: player.token, room: room.state() });
    });

    socket.on('room:config', (patch) => {
      const { room, player } = data;
      if (!room || !player || !allowRoom()) return;
      if (room.hostId !== player.id || room.phase !== 'lobby') return; // controle de permissões
      const valid = validateConfigPatch(patch);
      if (!valid) return player.guard.invalid();
      room.applyConfig(valid);
    });

    socket.on('room:start', (cb) => {
      const { room, player } = data;
      if (!room || !player || !allowRoom()) return ack(cb, { ok: false, error: 'Sem sala.' });
      if (room.hostId !== player.id) return ack(cb, { ok: false, error: 'Somente o anfitrião pode iniciar.' });
      ack(cb, room.start(Date.now()));
    });

    socket.on('room:end', () => {
      const { room, player } = data;
      if (!room || !player || !allowRoom()) return;
      if (room.hostId !== player.id) return;
      room.end('host', null);
    });

    socket.on('room:leave', () => {
      this.leaveCurrent(socket);
    });

    socket.on('input', (cmds) => {
      const { room, player } = data;
      if (!room || !player) return;
      if (!player.guard.allow('input')) return kickIfNeeded();
      const valid = validateCmdBatch(cmds);
      if (!valid) {
        player.guard.invalid();
        return kickIfNeeded();
      }
      if (room.phase === 'playing' && room.match) room.match.enqueue(player, valid);
    });

    socket.on('net:ping', (p, cb) => {
      const player = data.player;
      if (player && !player.guard.allow('ping')) return;
      if (player && typeof p?.rtt === 'number' && Number.isFinite(p.rtt)) {
        player.ping = Math.max(0, Math.min(2000, p.rtt));
      }
      ack(cb, Date.now());
    });

    // Gancho exclusivo de testes automatizados (desligado em produção): posiciona o próprio jogador.
    if (process.env.NULLPOINT_TEST_HOOKS === '1') {
      (socket as unknown as { on(ev: string, fn: (p: { x: number; z: number }) => void): void }).on('test:place', (p) => {
        const { player } = data;
        if (!player || !Number.isFinite(p?.x) || !Number.isFinite(p?.z)) return;
        player.sim.pos = { x: p.x, y: 0.05, z: p.z };
        player.sim.vel = { x: 0, y: 0, z: 0 };
        player.protectedUntil = 0;
      });
    }

    socket.on('disconnect', () => {
      const { room, player } = data;
      if (room && player && player.socket === socket) room.disconnect(player, Date.now());
    });
  }

  stats() {
    return { rooms: this.rooms.size, protocol: PROTOCOL_VERSION };
  }
}
