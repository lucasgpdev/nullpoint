import { lerp, lerpAngle, type NetPlayer } from '@nullpoint/shared';

export interface InterpState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  spd: number;
  f: number;
  hp: number;
}

interface Entry extends InterpState {
  t: number;
}

/** Buffer de snapshots de um jogador remoto, renderizado com atraso fixo para suavizar a rede. */
export class Interpolator {
  private buf: Entry[] = [];

  push(t: number, p: NetPlayer): void {
    const last = this.buf[this.buf.length - 1];
    if (last && t <= last.t) return;
    this.buf.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, spd: p.spd, f: p.f, hp: p.hp });
    if (this.buf.length > 40) this.buf.shift();
  }

  /** Descarta o histórico (ex.: respawn), evitando deslizar pelo mapa. */
  reset(): void {
    this.buf = this.buf.slice(-1);
    if (this.buf[0]) this.buf[0].t = -Infinity;
  }

  get latest(): Entry | undefined {
    return this.buf[this.buf.length - 1];
  }

  sample(renderTime: number): InterpState | null {
    const b = this.buf;
    if (b.length === 0) return null;
    if (renderTime <= b[0].t || b.length === 1) return b[0];
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1];
      const c = b[i];
      if (renderTime >= a.t) {
        if (renderTime >= c.t) {
          // Sem dados novos: mantém a última posição (sem extrapolar para não "teleportar").
          return c;
        }
        const t = (renderTime - a.t) / (c.t - a.t);
        return {
          x: lerp(a.x, c.x, t),
          y: lerp(a.y, c.y, t),
          z: lerp(a.z, c.z, t),
          yaw: lerpAngle(a.yaw, c.yaw, t),
          pitch: lerp(a.pitch, c.pitch, t),
          spd: lerp(a.spd, c.spd, t),
          f: t < 0.5 ? a.f : c.f,
          hp: c.hp,
        };
      }
    }
    return b[b.length - 1];
  }
}
