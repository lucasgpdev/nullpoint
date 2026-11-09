import {
  DEFAULT_MAP,
  RECONNECT_GRACE_MS,
  RESULTS_SCREEN_MS,
  type MatchEnd,
  type RoomConfig,
  type RoomPhase,
  type RoomState,
} from '@nullpoint/shared';
import { Match } from '../matches/Match';
import { PLAYER_COLORS, type GameSocket, ServerPlayer } from '../players/ServerPlayer';

export class Room {
  phase: RoomPhase = 'lobby';
  config: RoomConfig = { maxPlayers: 10, mode: 'deathmatch', map: DEFAULT_MAP, killLimit: 10, timeLimitMin: 10 };
  readonly players = new Map<number, ServerPlayer>();
  hostId = -1;
  match: Match | null = null;
  private lobbyAt = 0;
  private dirty = true;
  private lastStateBroadcast = 0;
  lastActivity = Date.now();

  constructor(
    readonly code: string,
    private readonly nextId: () => number,
  ) {}

  get connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  get isFull(): boolean {
    return this.players.size >= this.config.maxPlayers;
  }

  addPlayer(socket: GameSocket, name: string, token: string, now: number): ServerPlayer {
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
    const p = new ServerPlayer(this.nextId(), this.uniqueName(name), color, token, socket);
    this.players.set(p.id, p);
    if (this.hostId < 0) this.hostId = p.id;
    socket.join(this.code);
    if (this.phase === 'playing' && this.match) this.match.addLatePlayer(p, now);
    this.markDirty();
    return p;
  }

  private uniqueName(name: string): string {
    const names = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!names.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const n = `${name.slice(0, 13)}#${i}`;
      if (!names.has(n.toLowerCase())) return n;
    }
  }

  reattach(p: ServerPlayer, socket: GameSocket): void {
    p.socket = socket;
    p.connected = true;
    p.disconnectedAt = 0;
    p.queue = [];
    p.budget = 0;
    socket.join(this.code);
    if (this.phase === 'playing' && this.match && !p.alive && !p.respawnAt) this.match.spawn(p, Date.now());
    this.markDirty();
  }

  disconnect(p: ServerPlayer, now: number): void {
    p.connected = false;
    p.disconnectedAt = now;
    p.socket = null;
    p.queue = [];
    this.match?.removePlayer(p.id);
    this.migrateHost();
    this.markDirty();
  }

  remove(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.socket?.leave(this.code);
    this.players.delete(id);
    this.match?.removePlayer(id);
    this.migrateHost();
    this.markDirty();
  }

  private migrateHost(): void {
    const host = this.players.get(this.hostId);
    if (host && host.connected) return;
    const next = [...this.players.values()].find((p) => p.connected);
    this.hostId = next ? next.id : -1;
  }

  applyConfig(patch: Partial<RoomConfig>): void {
    if (patch.maxPlayers !== undefined && patch.maxPlayers < this.players.size) patch.maxPlayers = this.players.size;
    this.config = { ...this.config, ...patch };
    this.markDirty();
  }

  start(now: number): { ok: boolean; error?: string } {
    if (this.phase === 'playing') return { ok: false, error: 'A partida já está em andamento.' };
    if (this.connectedCount < 1) return { ok: false, error: 'Nenhum jogador conectado.' };
    this.match?.stop();
    this.phase = 'playing';
    this.match = new Match(this.config, this.players, { onKillLimit: (id) => this.end('kills', id) }, now);
    for (const p of this.players.values()) p.queue = [];
    this.broadcastMatchStart();
    this.markDirty();
    return { ok: true };
  }

  broadcastMatchStart(target?: ServerPlayer): void {
    if (!this.match) return;
    const payload = {
      map: this.config.map,
      startedAt: this.match.startedAt,
      endsAt: this.match.endsAt,
      killLimit: this.config.killLimit,
    };
    if (target) target.socket?.emit('match:start', payload);
    else for (const p of this.players.values()) p.socket?.emit('match:start', payload);
  }

  end(reason: MatchEnd['reason'], winnerId: number | null, now = Date.now()): void {
    if (this.phase !== 'playing') return;
    this.match?.stop();
    if (winnerId === null) {
      const ranked = [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      winnerId = ranked[0] && ranked[0].kills > 0 ? ranked[0].id : null;
    }
    this.phase = 'ended';
    this.lobbyAt = now + RESULTS_SCREEN_MS;
    const payload: MatchEnd = {
      winnerId,
      reason,
      players: [...this.players.values()].map((p) => p.info(this.hostId)),
      backToLobbyAt: this.lobbyAt,
    };
    for (const p of this.players.values()) p.socket?.emit('match:end', payload);
    this.markDirty();
  }

  /** Chamado pelo loop global do servidor. */
  update(now: number, elapsedMs: number): void {
    if (this.connectedCount > 0) this.lastActivity = now;
    if (this.phase === 'playing' && this.match) {
      this.match.update(now, elapsedMs);
      if (now >= this.match.endsAt) this.end('time', null, now);
    } else if (this.phase === 'ended' && now >= this.lobbyAt) {
      this.phase = 'lobby';
      this.match = null;
      for (const p of this.players.values()) {
        p.alive = false;
        p.respawnAt = 0;
      }
      this.markDirty();
    }

    // Remove quem não voltou dentro do período de reconexão.
    for (const p of [...this.players.values()]) {
      if (!p.connected && now - p.disconnectedAt > RECONNECT_GRACE_MS) this.remove(p.id);
    }

    // Estado da sala: imediatamente quando muda, e a cada 2 s para atualizar o ping.
    if (this.dirty || now - this.lastStateBroadcast > 2000) {
      this.dirty = false;
      this.lastStateBroadcast = now;
      const s = this.state();
      for (const p of this.players.values()) p.socket?.emit('room:state', s);
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  state(): RoomState {
    return {
      code: this.code,
      phase: this.phase,
      config: this.config,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => p.info(this.hostId)),
      matchEndsAt: this.match?.endsAt,
    };
  }
}
