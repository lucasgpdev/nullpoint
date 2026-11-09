import { HISTORY_MS, lerpV3, MAX_LAG_COMP_MS, type Vec3 } from '@nullpoint/shared';

interface Frame {
  t: number;
  players: Map<number, { pos: Vec3; alive: boolean }>;
}

/**
 * Histórico de posições dos jogadores para compensação de latência.
 * Ao validar um disparo, o servidor reconstrói onde os alvos estavam no instante que o atirador via.
 */
export class LagCompensation {
  private frames: Frame[] = [];

  record(t: number, players: Iterable<{ id: number; pos: Vec3; alive: boolean }>): void {
    const map = new Map<number, { pos: Vec3; alive: boolean }>();
    for (const p of players) map.set(p.id, { pos: { ...p.pos }, alive: p.alive });
    this.frames.push({ t, players: map });
    const cutoff = t - HISTORY_MS;
    while (this.frames.length > 2 && this.frames[0].t < cutoff) this.frames.shift();
  }

  /** Limita o tempo de rebobinagem a uma janela segura. */
  clampTime(viewTime: number, now: number): number {
    return Math.min(now, Math.max(now - MAX_LAG_COMP_MS, viewTime));
  }

  /** Posição interpolada de um jogador no tempo `t`; null se não existia/estava morto. */
  positionAt(id: number, t: number): Vec3 | null {
    const f = this.frames;
    if (f.length === 0) return null;
    if (t <= f[0].t) return this.at(f[0], id);
    const last = f[f.length - 1];
    if (t >= last.t) return this.at(last, id);
    // Busca binária pelo par de quadros que envolve t.
    let lo = 0;
    let hi = f.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = f[lo].players.get(id);
    const b = f[hi].players.get(id);
    if (!a || !b || !a.alive || !b.alive) return null;
    const alpha = (t - f[lo].t) / (f[hi].t - f[lo].t || 1);
    return lerpV3(a.pos, b.pos, alpha);
  }

  private at(frame: Frame, id: number): Vec3 | null {
    const p = frame.players.get(id);
    return p && p.alive ? { ...p.pos } : null;
  }

  clear(): void {
    this.frames = [];
  }
}
