import type { Vec3 } from './math';

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export const EPS = 1e-4;

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x - EPS &&
    a.max.x > b.min.x + EPS &&
    a.min.y < b.max.y - EPS &&
    a.max.y > b.min.y + EPS &&
    a.min.z < b.max.z - EPS &&
    a.max.z > b.min.z + EPS
  );
}

/**
 * Interseção raio × AABB (método dos slabs).
 * Retorna a distância t ao longo de `dir` (normalizado) ou -1 se não houver acerto.
 */
export function rayAABB(origin: Vec3, dir: Vec3, box: AABB, maxDist = Infinity): number {
  let tmin = 0;
  let tmax = maxDist;
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = origin[axis];
    const d = dir[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
    } else {
      const inv = 1 / d;
      let t1 = (lo - o) * inv;
      let t2 = (hi - o) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

/** Normal da face do AABB atingida em `point` (para decalques e partículas). */
export function aabbHitNormal(box: AABB, point: Vec3): Vec3 {
  const d = [
    { n: { x: -1, y: 0, z: 0 }, v: Math.abs(point.x - box.min.x) },
    { n: { x: 1, y: 0, z: 0 }, v: Math.abs(point.x - box.max.x) },
    { n: { x: 0, y: -1, z: 0 }, v: Math.abs(point.y - box.min.y) },
    { n: { x: 0, y: 1, z: 0 }, v: Math.abs(point.y - box.max.y) },
    { n: { x: 0, y: 0, z: -1 }, v: Math.abs(point.z - box.min.z) },
    { n: { x: 0, y: 0, z: 1 }, v: Math.abs(point.z - box.max.z) },
  ];
  d.sort((a, b) => a.v - b.v);
  return d[0].n;
}

/**
 * Mundo de colisão estático com grade espacial simples para consultas rápidas.
 */
export class CollisionWorld {
  readonly boxes: AABB[];
  private readonly cell = 4;
  private readonly grid = new Map<string, number[]>();

  constructor(boxes: AABB[]) {
    this.boxes = boxes;
    boxes.forEach((b, i) => {
      const x0 = Math.floor(b.min.x / this.cell);
      const x1 = Math.floor(b.max.x / this.cell);
      const z0 = Math.floor(b.min.z / this.cell);
      const z1 = Math.floor(b.max.z / this.cell);
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const k = `${x},${z}`;
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, (arr = []));
          arr.push(i);
        }
    });
  }

  /** Caixas candidatas que podem tocar a região informada. */
  query(region: AABB, out: AABB[] = []): AABB[] {
    out.length = 0;
    const seen = new Set<number>();
    const x0 = Math.floor(region.min.x / this.cell);
    const x1 = Math.floor(region.max.x / this.cell);
    const z0 = Math.floor(region.min.z / this.cell);
    const z1 = Math.floor(region.max.z / this.cell);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const arr = this.grid.get(`${x},${z}`);
        if (!arr) continue;
        for (const i of arr) {
          if (seen.has(i)) continue;
          seen.add(i);
          out.push(this.boxes[i]);
        }
      }
    return out;
  }

  overlapsAny(region: AABB): AABB | null {
    for (const b of this.query(region)) if (aabbOverlap(region, b)) return b;
    return null;
  }

  /** Raycast contra a geometria estática. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number): { t: number; box: AABB } | null {
    let best: { t: number; box: AABB } | null = null;
    // O mapa é pequeno; percorrer todas as caixas é barato e evita erros de travessia de grade.
    for (const b of this.boxes) {
      const t = rayAABB(origin, dir, b, best ? best.t : maxDist);
      if (t >= 0 && (!best || t < best.t)) best = { t, box: b };
    }
    return best;
  }
}
