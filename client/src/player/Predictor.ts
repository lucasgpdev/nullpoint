import {
  applyCommand,
  cloneSimState,
  createSimState,
  DEFAULT_WEAPON,
  type CollisionWorld,
  type InputCmd,
  type NetSelf,
  type PlayerSimState,
  type SimStepResult,
  type Vec3,
} from '@nullpoint/shared';

/**
 * Previsão local + reconciliação.
 * O jogador vê o próprio movimento imediatamente; quando chega o estado do servidor,
 * o estado é corrigido e os comandos ainda não confirmados são reaplicados.
 */
export class Predictor {
  state: PlayerSimState;
  prev: PlayerSimState;
  private pending: InputCmd[] = [];
  /** Erro visual residual após correção, suavizado ao longo de alguns quadros. */
  readonly smoothing: Vec3 = { x: 0, y: 0, z: 0 };
  corrections = 0;
  lastError = 0;

  constructor(private readonly world: CollisionWorld) {
    this.state = createSimState({ x: 0, y: 0, z: 0 }, 0, DEFAULT_WEAPON);
    this.prev = cloneSimState(this.state);
  }

  /** Reinicia a partir de um estado do servidor (spawn/reconexão). */
  resetFrom(me: NetSelf, yaw?: number): void {
    this.fromNet(me);
    if (yaw !== undefined) this.state.yaw = yaw;
    this.pending = [];
    this.prev = cloneSimState(this.state);
    this.smoothing.x = this.smoothing.y = this.smoothing.z = 0;
  }

  private fromNet(me: NetSelf): void {
    const s = this.state;
    s.pos = { x: me.pos[0], y: me.pos[1], z: me.pos[2] };
    s.vel = { x: me.vel[0], y: me.vel[1], z: me.vel[2] };
    s.onGround = me.onGround;
    s.weapon = { ...me.weapon };
  }

  apply(cmd: InputCmd): SimStepResult {
    this.prev = cloneSimState(this.state);
    const r = applyCommand(this.world, this.state, cmd);
    this.pending.push(cmd);
    if (this.pending.length > 240) this.pending.shift();
    return r;
  }

  reconcile(me: NetSelf): void {
    this.pending = this.pending.filter((c) => c.seq > me.ack);
    const before = { ...this.state.pos };
    const yaw = this.state.yaw;
    const pitch = this.state.pitch;
    const prevBefore = { ...this.prev.pos };
    this.fromNet(me);
    for (const c of this.pending) applyCommand(this.world, this.state, c);
    this.state.yaw = yaw;
    this.state.pitch = pitch;

    const ex = before.x - this.state.pos.x;
    const ey = before.y - this.state.pos.y;
    const ez = before.z - this.state.pos.z;
    const err = Math.hypot(ex, ey, ez);
    this.lastError = err;
    if (err > 1e-3) {
      this.corrections++;
      if (err < 1.5) {
        // Pequeno: suaviza visualmente.
        this.smoothing.x += ex;
        this.smoothing.y += ey;
        this.smoothing.z += ez;
      }
      // Mantém o intervalo de interpolação coerente com o novo estado.
      this.prev.pos = { x: prevBefore.x - ex, y: prevBefore.y - ey, z: prevBefore.z - ez };
    }
  }

  decaySmoothing(dt: number): void {
    const k = Math.exp(-dt * 14);
    this.smoothing.x *= k;
    this.smoothing.y *= k;
    this.smoothing.z *= k;
  }
}
