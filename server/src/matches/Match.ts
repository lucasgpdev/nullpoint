import {
  applyCommand,
  CMD_BUDGET_MAX,
  createSimState,
  DEFAULT_WEAPON,
  distSq,
  eyePosition,
  getCollisionWorld,
  KILL_PLANE_Y,
  MAPS,
  MAX_CMD_QUEUE,
  MAX_HEALTH,
  NetFlags,
  q,
  RESPAWN_DELAY_MS,
  shotDirection,
  SIM_DT,
  SNAPSHOT_HZ,
  SPAWN_PROTECTION_MS,
  WEAPONS,
  type CollisionWorld,
  type GameEvent,
  type InputCmd,
  type MapDef,
  type NetPlayer,
  type RoomConfig,
  type SpawnPoint,
  type Vec3,
} from '@nullpoint/shared';
import { hitscan, type HitTarget } from '../combat/hitscan';
import { LagCompensation } from '../combat/LagCompensation';
import type { ServerPlayer } from '../players/ServerPlayer';

const ASSIST_MIN_DAMAGE = 40;
const ASSIST_WINDOW_MS = 10000;

export interface MatchHooks {
  onKillLimit(winnerId: number): void;
}

/**
 * Partida autoritativa. O servidor simula todos os jogadores a partir dos comandos recebidos,
 * valida disparos com compensação de latência e decide dano, abates e respawns.
 */
export class Match {
  readonly map: MapDef;
  readonly world: CollisionWorld;
  readonly startedAt: number;
  readonly endsAt: number;
  readonly lag = new LagCompensation();
  private tick = 0;
  private snapAccum = 0;
  private ended = false;

  constructor(
    readonly config: RoomConfig,
    private readonly players: Map<number, ServerPlayer>,
    private readonly hooks: MatchHooks,
    now: number,
  ) {
    this.map = MAPS[config.map];
    this.world = getCollisionWorld(config.map);
    this.startedAt = now;
    this.endsAt = now + config.timeLimitMin * 60_000;
    for (const p of players.values()) {
      p.resetStats();
      this.spawn(p, now);
    }
  }

  private active(): ServerPlayer[] {
    return [...this.players.values()].filter((p) => p.connected);
  }

  /** Escolhe o ponto de spawn mais distante dos inimigos vivos. */
  private pickSpawn(p: ServerPlayer): SpawnPoint {
    const enemies = this.active().filter((o) => o !== p && o.alive);
    const spawns = this.map.spawns;
    if (enemies.length === 0) return spawns[Math.floor(Math.random() * spawns.length)];
    let best = spawns[0];
    let bestScore = -1;
    for (const s of spawns) {
      const d = Math.min(...enemies.map((e) => distSq(e.sim.pos, s.pos)));
      const score = d * (0.75 + Math.random() * 0.5); // leve aleatoriedade para não ser previsível
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  spawn(p: ServerPlayer, now: number): void {
    const s = this.pickSpawn(p);
    p.sim = createSimState(s.pos, s.yaw, DEFAULT_WEAPON);
    p.hp = MAX_HEALTH;
    p.alive = true;
    p.protectedUntil = now + SPAWN_PROTECTION_MS;
    p.damageBy.clear();
    this.broadcast({ k: 'spawn', id: p.id, pos: [s.pos.x, s.pos.y, s.pos.z], yaw: s.yaw });
  }

  /** Jogador entrou com a partida em andamento. */
  addLatePlayer(p: ServerPlayer, now: number): void {
    p.resetStats();
    p.queue = [];
    this.spawn(p, now);
  }

  enqueue(p: ServerPlayer, cmds: InputCmd[]): void {
    for (const c of cmds) {
      if (c.seq <= p.lastSeq) continue; // repetido ou fora de ordem
      p.queue.push(c);
    }
    // Fila excessiva = cliente adiantado ou tentativa de speed hack: descarta os mais antigos.
    if (p.queue.length > MAX_CMD_QUEUE) p.queue.splice(0, p.queue.length - MAX_CMD_QUEUE);
  }

  update(now: number, elapsedMs: number): void {
    if (this.ended) return;
    this.tick++;
    const budgetGain = elapsedMs / (SIM_DT * 1000);

    for (const p of this.active()) {
      // Orçamento de comandos: o jogador só avança no tempo na mesma velocidade do relógio real.
      p.budget = Math.min(CMD_BUDGET_MAX, p.budget + budgetGain);
      while (p.queue.length && p.budget >= 1) {
        const cmd = p.queue.shift()!;
        if (cmd.seq <= p.lastSeq) continue;
        p.lastSeq = cmd.seq;
        p.budget -= 1;
        if (!p.alive) continue;
        this.runCommand(p, cmd, now);
        if (this.ended) return;
      }
      if (p.alive && p.sim.pos.y < KILL_PLANE_Y) this.kill(p, null, false, now);
      if (!p.alive && p.respawnAt && now >= p.respawnAt) this.spawn(p, now);
    }

    this.lag.record(
      now,
      this.active().map((p) => ({ id: p.id, pos: p.sim.pos, alive: p.alive })),
    );

    this.snapAccum += elapsedMs;
    if (this.snapAccum >= 1000 / SNAPSHOT_HZ - 1) {
      this.snapAccum = 0;
      this.sendSnapshots(now);
    }
    this.flushEvents();
  }

  private runCommand(p: ServerPlayer, cmd: InputCmd, now: number): void {
    const res = applyCommand(this.world, p.sim, cmd);
    if (res.weapon.reloadStarted) this.broadcast({ k: 'reload', id: p.id }, p.id);
    if (!res.weapon.fired) return;

    p.protectedUntil = 0; // atirar cancela a proteção de spawn
    p.shotsFired++;
    const def = WEAPONS[p.sim.weapon.id];
    const origin = eyePosition(p.sim.pos);
    const t = this.lag.clampTime(cmd.viewTime, now);
    const targets: HitTarget[] = [];
    for (const o of this.active()) {
      if (o === p || !o.alive) continue;
      const pos = this.lag.positionAt(o.id, t);
      if (pos) targets.push({ id: o.id, pos });
    }

    for (let pellet = 0; pellet < def.pellets; pellet++) {
      const dir = shotDirection(res.yaw, res.pitch, res.weapon.spread, p.id, res.weapon.shotIndex, pellet);
      const hit = hitscan(this.world, origin, dir, def, targets);
      const ev: GameEvent = {
        k: 'shot',
        id: p.id,
        o: [q(origin.x), q(origin.y), q(origin.z)],
        e: [q(hit.end.x), q(hit.end.y), q(hit.end.z)],
      };
      if (hit.normal) ev.n = [hit.normal.x, hit.normal.y, hit.normal.z];
      if (hit.victim !== undefined) ev.hit = hit.victim;
      this.broadcast(ev, p.id);
      if (hit.victim !== undefined) {
        const victim = this.players.get(hit.victim)!;
        this.damage(p, victim, hit.damage, hit.zone === 'head', origin, now);
        if (this.ended) return;
      }
    }
  }

  private damage(att: ServerPlayer, victim: ServerPlayer, dmg: number, head: boolean, from: Vec3, now: number): void {
    if (!victim.alive) return;
    if (now < victim.protectedUntil) {
      att.send({ k: 'hit', victim: victim.id, dmg: 0, head, kill: false });
      return;
    }
    att.shotsHit++;
    victim.hp -= dmg;
    const prev = victim.damageBy.get(att.id);
    victim.damageBy.set(att.id, { dmg: (prev?.dmg ?? 0) + dmg, at: now });
    const kill = victim.hp <= 0;
    att.send({ k: 'hit', victim: victim.id, dmg, head, kill });
    victim.send({ k: 'hurt', from: [q(from.x), q(from.y), q(from.z)], dmg, hp: Math.max(0, victim.hp) });
    if (kill) this.kill(victim, att, head, now);
  }

  private kill(victim: ServerPlayer, killer: ServerPlayer | null, head: boolean, now: number): void {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.respawnAt = now + RESPAWN_DELAY_MS;
    victim.queue = [];

    let assistId: number | undefined;
    if (killer && killer !== victim) {
      killer.kills++;
      if (head) killer.headshots++;
      let best = 0;
      for (const [id, d] of victim.damageBy) {
        if (id === killer.id || now - d.at > ASSIST_WINDOW_MS || d.dmg < ASSIST_MIN_DAMAGE) continue;
        if (d.dmg > best) {
          best = d.dmg;
          assistId = id;
        }
      }
      if (assistId !== undefined) {
        const a = this.players.get(assistId);
        if (a) a.assists++;
        else assistId = undefined;
      }
    }
    this.broadcast({
      k: 'kill',
      killer: killer ? killer.id : victim.id,
      victim: victim.id,
      head,
      weapon: killer ? killer.sim.weapon.id : 'world',
      assist: assistId,
    });
    if (killer && killer.kills >= this.config.killLimit) {
      this.ended = true;
      this.flushEvents();
      this.hooks.onKillLimit(killer.id);
    }
  }

  removePlayer(id: number): void {
    this.broadcast({ k: 'leave', id });
  }

  private broadcast(ev: GameEvent, exclude?: number): void {
    for (const p of this.active()) if (p.id !== exclude) p.send(ev);
  }

  private flushEvents(): void {
    for (const p of this.players.values()) {
      if (p.outbox.length === 0) continue;
      if (p.connected && p.socket) p.socket.emit('ev', p.outbox);
      p.outbox = [];
    }
  }

  private sendSnapshots(now: number): void {
    const active = this.active();
    const list: NetPlayer[] = active.map((p) => {
      let f = 0;
      if (p.alive) f |= NetFlags.Alive;
      if (p.sim.onGround) f |= NetFlags.Ground;
      if (p.sim.weapon.reloadLeft > 0) f |= NetFlags.Reloading;
      if (now < p.protectedUntil) f |= NetFlags.Protected;
      return {
        id: p.id,
        x: q(p.sim.pos.x),
        y: q(p.sim.pos.y),
        z: q(p.sim.pos.z),
        yaw: q(p.sim.yaw),
        pitch: q(p.sim.pitch),
        spd: q(Math.hypot(p.sim.vel.x, p.sim.vel.z), 100),
        f,
        hp: Math.max(0, Math.round(p.hp)),
      };
    });
    for (const p of active) {
      p.socket?.emit('snap', { t: now, tick: this.tick, players: list, me: p.netSelf() });
    }
  }

  get isEnded(): boolean {
    return this.ended;
  }

  stop(): void {
    this.ended = true;
    this.lag.clear();
  }
}
