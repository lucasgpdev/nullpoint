/**
 * Sistema de animação por keyframes para viewmodels procedurais.
 * Cada clipe anima canais numéricos (posição, rotação, peças da arma) com easing por chave.
 * Um GltfViewModel futuro pode usar THREE.AnimationMixer mantendo os mesmos nomes de clipe.
 */

export type Ease = (t: number) => number;
export const Easing = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  out: (t: number) => 1 - (1 - t) ** 3,
  in: (t: number) => t * t * t,
  outBack: (t: number) => {
    const c1 = 1.5;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
} satisfies Record<string, Ease>;

/** [tempo (s), valor, easing até esta chave] */
export type Key = [number, number, Ease?];

export interface Clip<C extends string> {
  name: string;
  duration: number;
  tracks: Partial<Record<C, Key[]>>;
  /** Eventos disparados em tempos específicos (ex.: som do carregador). */
  events?: [number, string][];
  loop?: boolean;
}

function sampleTrack(keys: Key[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const u = (t - t0) / (t1 - t0 || 1);
      return v0 + (v1 - v0) * (ease ?? Easing.inOut)(u);
    }
  }
  return keys[keys.length - 1][1];
}

export class ClipPlayer<C extends string> {
  private clip: Clip<C> | null = null;
  private time = 0;
  private speed = 1;
  private firedEvents = new Set<number>();
  private blendFrom: Partial<Record<C, number>> = {};
  private blendTime = 0;
  private blendDur = 0;
  onEvent?: (name: string) => void;

  constructor(private readonly channels: readonly C[]) {}

  get current(): string | null {
    return this.clip ? this.clip.name : null;
  }

  get progress(): number {
    return this.clip ? this.time / this.clip.duration : 1;
  }

  /** Inicia um clipe com transição suave a partir da pose atual. */
  play(clip: Clip<C>, opts: { speed?: number; blend?: number; duration?: number } = {}): void {
    for (const c of this.channels) this.blendFrom[c] = this.value(c);
    this.blendDur = opts.blend ?? 0.08;
    this.blendTime = 0;
    this.clip = clip;
    this.time = 0;
    this.speed = opts.duration ? clip.duration / opts.duration : (opts.speed ?? 1);
    this.firedEvents.clear();
  }

  stop(blend = 0.12): void {
    for (const c of this.channels) this.blendFrom[c] = this.value(c);
    this.blendDur = blend;
    this.blendTime = 0;
    this.clip = null;
  }

  update(dt: number): void {
    this.blendTime += dt;
    if (!this.clip) return;
    this.time += dt * this.speed;
    if (this.clip.events) {
      this.clip.events.forEach(([t, name], i) => {
        if (this.time >= t && !this.firedEvents.has(i)) {
          this.firedEvents.add(i);
          this.onEvent?.(name);
        }
      });
    }
    if (this.time >= this.clip.duration) {
      if (this.clip.loop) {
        this.time %= this.clip.duration;
        this.firedEvents.clear();
      } else {
        this.clip = null;
      }
    }
  }

  private raw(c: C): number {
    const keys = this.clip?.tracks[c];
    return keys ? sampleTrack(keys, this.time) : 0;
  }

  value(c: C): number {
    const v = this.raw(c);
    if (this.blendTime >= this.blendDur || this.blendDur <= 0) return v;
    const from = this.blendFrom[c] ?? 0;
    const u = Easing.inOut(this.blendTime / this.blendDur);
    return from + (v - from) * u;
  }
}
