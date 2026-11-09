import {
  aabbHitNormal,
  damageAtDistance,
  hitboxesAt,
  rayAABB,
  type CollisionWorld,
  type HitZone,
  type Vec3,
  type WeaponDef,
} from '@nullpoint/shared';

export interface HitTarget {
  id: number;
  /** Posição (pés) já rebobinada para o instante do disparo. */
  pos: Vec3;
}

export interface HitscanResult {
  end: Vec3;
  normal?: Vec3;
  victim?: number;
  zone?: HitZone;
  distance: number;
  damage: number;
}

/** Raycast de um projétil contra o mundo e contra as hitboxes dos alvos. */
export function hitscan(
  world: CollisionWorld,
  origin: Vec3,
  dir: Vec3,
  def: WeaponDef,
  targets: HitTarget[],
): HitscanResult {
  const wh = world.raycast(origin, dir, def.range);
  let bestT = wh ? wh.t : def.range;
  let victim: number | undefined;
  let zone: HitZone | undefined;

  for (const t of targets) {
    for (const hb of hitboxesAt(t.pos)) {
      const d = rayAABB(origin, dir, hb.box, bestT);
      if (d >= 0 && d < bestT) {
        bestT = d;
        victim = t.id;
        zone = hb.zone;
      }
    }
  }

  const end = { x: origin.x + dir.x * bestT, y: origin.y + dir.y * bestT, z: origin.z + dir.z * bestT };
  if (victim === undefined) {
    return { end, distance: bestT, damage: 0, normal: wh && wh.t <= bestT ? aabbHitNormal(wh.box, end) : undefined };
  }
  let dmg = damageAtDistance(def, bestT);
  if (zone === 'head') dmg *= def.headMult;
  else if (zone === 'legs') dmg *= def.legMult;
  return { end, victim, zone, distance: bestT, damage: Math.round(dmg) };
}
