import {
  createSimState,
  DEFAULT_WEAPON,
  MAX_HEALTH,
  q,
  type GameEvent,
  type InputCmd,
  type NetSelf,
  type PlayerInfo,
  type PlayerSimState,
  type ServerToClient,
  type ClientToServer,
} from '@nullpoint/shared';
import type { Socket } from 'socket.io';
import { ConnectionGuard } from '../security/RateLimiter';

export type GameSocket = Socket<ClientToServer, ServerToClient>;

export const PLAYER_COLORS = [0xff6a2b, 0x2bd9ff, 0xc6ff3d, 0xff3d8b, 0xffd23d, 0x8b6bff, 0x3dffb0, 0xff9a9a, 0x6b9bff, 0xe0e0e0];

export class ServerPlayer {
  socket: GameSocket | null;
  connected = true;
  disconnectedAt = 0;
  ping = 0;
  guard = new ConnectionGuard();

  // Estatísticas da partida
  kills = 0;
  deaths = 0;
  assists = 0;
  headshots = 0;
  shotsFired = 0;
  shotsHit = 0;

  // Estado de jogo
  sim: PlayerSimState = createSimState({ x: 0, y: 0, z: 0 }, 0, DEFAULT_WEAPON);
  hp = MAX_HEALTH;
  alive = false;
  respawnAt = 0;
  protectedUntil = 0;
  /** Dano recebido por atacante (para assistências). */
  damageBy = new Map<number, { dmg: number; at: number }>();

  // Rede
  queue: InputCmd[] = [];
  lastSeq = -1;
  budget = 0;
  outbox: GameEvent[] = [];

  constructor(
    readonly id: number,
    public name: string,
    readonly color: number,
    readonly token: string,
    socket: GameSocket,
  ) {
    this.socket = socket;
  }

  get score(): number {
    return this.kills * 2 + this.assists;
  }

  resetStats(): void {
    this.kills = this.deaths = this.assists = this.headshots = this.shotsFired = this.shotsHit = 0;
    this.damageBy.clear();
  }

  info(hostId: number): PlayerInfo {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      connected: this.connected,
      ping: Math.round(this.ping),
      isHost: this.id === hostId,
      kills: this.kills,
      deaths: this.deaths,
      assists: this.assists,
      headshots: this.headshots,
      score: this.score,
    };
  }

  netSelf(): NetSelf {
    const s = this.sim;
    return {
      ack: this.lastSeq,
      pos: [q(s.pos.x, 1e4), q(s.pos.y, 1e4), q(s.pos.z, 1e4)],
      vel: [q(s.vel.x, 1e4), q(s.vel.y, 1e4), q(s.vel.z, 1e4)],
      onGround: s.onGround,
      weapon: { ...s.weapon, cooldown: q(s.weapon.cooldown, 1e5), reloadLeft: q(s.weapon.reloadLeft, 1e5), drawLeft: q(s.weapon.drawLeft, 1e5), bloom: q(s.weapon.bloom, 1e6) },
      hp: Math.max(0, Math.round(this.hp)),
      alive: this.alive,
      respawnAt: this.respawnAt,
    };
  }

  send(ev: GameEvent): void {
    this.outbox.push(ev);
  }
}
