/**
 * Sistema de armas orientado a dados. Para adicionar uma arma: criar uma WeaponDef aqui
 * e registrar um ViewModel no cliente. Nenhuma mecânica precisa ser reescrita.
 */
import { clamp, dirFromAngles, rightFromYaw, type Vec3 } from './math';
import { Buttons } from './protocol';
import { hashSeed, mulberry32 } from './rng';

export type WeaponCategory = 'pistol' | 'rifle' | 'sniper' | 'shotgun' | 'smg' | 'melee';

export interface WeaponDef {
  id: string;
  name: string;
  category: WeaponCategory;
  /** Dano base no tronco. */
  damage: number;
  headMult: number;
  legMult: number;
  /** Alcance máximo (m). */
  range: number;
  /** Início/fim da queda de dano (m) e multiplicador mínimo. */
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;
  /** Intervalo mínimo entre disparos (s). */
  fireInterval: number;
  automatic: boolean;
  pellets: number;
  magSize: number;
  reserve: number;
  reloadTime: number;
  drawTime: number;
  speedMult: number;
  /** Dispersão em radianos. */
  spread: {
    base: number;
    move: number;
    sprint: number;
    air: number;
    perShot: number;
    max: number;
    recovery: number; // rad/s
  };
  /** Recuo visual da câmera (rad) por disparo. */
  recoil: { pitch: number; yawJitter: number; recover: number };
}

export const WEAPONS: Record<string, WeaponDef> = {
  warden: {
    id: 'warden',
    name: 'P9 WARDEN',
    category: 'pistol',
    damage: 31,
    headMult: 3.6,
    legMult: 0.75,
    range: 120,
    falloffStart: 18,
    falloffEnd: 45,
    falloffMin: 0.7,
    fireInterval: 0.15,
    automatic: false,
    pellets: 1,
    magSize: 12,
    reserve: 48,
    reloadTime: 2.0,
    drawTime: 0.45,
    speedMult: 1,
    spread: { base: 0.0035, move: 0.022, sprint: 0.05, air: 0.09, perShot: 0.011, max: 0.06, recovery: 0.09 },
    recoil: { pitch: 0.022, yawJitter: 0.006, recover: 7 },
  },
};

export const DEFAULT_WEAPON = 'warden';

export interface WeaponState {
  id: string;
  ammo: number;
  reserve: number;
  cooldown: number;
  reloadLeft: number;
  drawLeft: number;
  bloom: number;
  triggerHeld: boolean;
  shots: number;
}

export function createWeaponState(id: string): WeaponState {
  const d = WEAPONS[id];
  return {
    id,
    ammo: d.magSize,
    reserve: d.reserve,
    cooldown: 0,
    reloadLeft: 0,
    drawLeft: d.drawTime,
    bloom: 0,
    triggerHeld: false,
    shots: 0,
  };
}

export interface FireContext {
  horizontalSpeed: number;
  onGround: boolean;
  sprinting: boolean;
  walkSpeed: number;
}

export function currentSpread(def: WeaponDef, ws: WeaponState, ctx: FireContext): number {
  const moveFrac = clamp(ctx.horizontalSpeed / ctx.walkSpeed, 0, 1.5);
  let s = def.spread.base + ws.bloom + def.spread.move * moveFrac * moveFrac;
  if (ctx.sprinting && ctx.horizontalSpeed > 0.5) s += def.spread.sprint;
  if (!ctx.onGround) s += def.spread.air;
  return Math.min(s, def.spread.max + def.spread.air);
}

export interface WeaponStepResult {
  fired: boolean;
  spread: number;
  shotIndex: number;
  reloadStarted: boolean;
  dryFire: boolean;
}

/** Passo determinístico da arma (cadência, munição, recarga, dispersão). */
export function stepWeapon(ws: WeaponState, buttons: number, dt: number, ctx: FireContext): WeaponStepResult {
  const def = WEAPONS[ws.id];
  const res: WeaponStepResult = { fired: false, spread: 0, shotIndex: -1, reloadStarted: false, dryFire: false };
  ws.cooldown = Math.max(0, ws.cooldown - dt);
  ws.drawLeft = Math.max(0, ws.drawLeft - dt);
  ws.bloom = Math.max(0, ws.bloom - def.spread.recovery * dt);

  if (ws.reloadLeft > 0) {
    ws.reloadLeft -= dt;
    if (ws.reloadLeft <= 0) {
      ws.reloadLeft = 0;
      const need = def.magSize - ws.ammo;
      const take = Math.min(need, ws.reserve);
      ws.ammo += take;
      ws.reserve -= take;
    }
  }

  const firePressed = (buttons & Buttons.Fire) !== 0;
  const wantsFire = firePressed && (def.automatic || !ws.triggerHeld);
  const canAct = ws.drawLeft <= 0 && ws.reloadLeft <= 0;

  if ((buttons & Buttons.Reload) && canAct && ws.ammo < def.magSize && ws.reserve > 0) {
    ws.reloadLeft = def.reloadTime;
    res.reloadStarted = true;
  } else if (wantsFire && canAct && ws.cooldown <= 0) {
    if (ws.ammo > 0) {
      res.spread = currentSpread(def, ws, ctx);
      ws.ammo -= 1;
      ws.cooldown = def.fireInterval;
      ws.bloom = Math.min(def.spread.max, ws.bloom + def.spread.perShot);
      res.fired = true;
      res.shotIndex = ws.shots;
      ws.shots += 1;
    } else if (ws.reserve > 0) {
      ws.reloadLeft = def.reloadTime;
      res.reloadStarted = true;
    } else {
      res.dryFire = true;
      ws.cooldown = def.fireInterval;
    }
  }
  ws.triggerHeld = firePressed;
  return res;
}

/** Direção de um projétil com dispersão determinística (mesma semente no cliente e no servidor). */
export function shotDirection(
  yaw: number,
  pitch: number,
  spread: number,
  playerId: number,
  shotIndex: number,
  pellet = 0,
): Vec3 {
  const rng = mulberry32(hashSeed(playerId * 131 + pellet, shotIndex));
  const ang = rng() * Math.PI * 2;
  const rad = Math.sqrt(rng()) * spread;
  const fwd = dirFromAngles(yaw, pitch);
  const right = rightFromYaw(yaw);
  // up = right × fwd
  const up = {
    x: right.y * fwd.z - right.z * fwd.y,
    y: right.z * fwd.x - right.x * fwd.z,
    z: right.x * fwd.y - right.y * fwd.x,
  };
  const ox = Math.cos(ang) * rad;
  const oy = Math.sin(ang) * rad;
  const d = {
    x: fwd.x + right.x * ox + up.x * oy,
    y: fwd.y + right.y * ox + up.y * oy,
    z: fwd.z + right.z * ox + up.z * oy,
  };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
}

export function damageAtDistance(def: WeaponDef, dist: number): number {
  if (dist <= def.falloffStart) return def.damage;
  if (dist >= def.falloffEnd) return def.damage * def.falloffMin;
  const t = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return def.damage * (1 - t * (1 - def.falloffMin));
}
