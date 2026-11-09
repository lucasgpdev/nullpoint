import { EYE_HEIGHT, PITCH_LIMIT, PLAYER_HEIGHT, SIM_DT, WALK_SPEED } from './constants';
import type { AABB, CollisionWorld } from './collision';
import { clamp, v3, type Vec3 } from './math';
import { horizontalSpeed, stepMovement, type Kinematics } from './physics';
import { Buttons, type InputCmd } from './protocol';
import { createWeaponState, stepWeapon, WEAPONS, type WeaponState, type WeaponStepResult } from './weapons';

/** Estado simulado (previsível) de um jogador. */
export interface PlayerSimState extends Kinematics {
  yaw: number;
  pitch: number;
  weapon: WeaponState;
}

export function createSimState(pos: Vec3, yaw: number, weaponId: string): PlayerSimState {
  return { pos: { ...pos }, vel: v3(), onGround: false, yaw, pitch: 0, weapon: createWeaponState(weaponId) };
}

export function cloneSimState(s: PlayerSimState): PlayerSimState {
  return {
    pos: { ...s.pos },
    vel: { ...s.vel },
    onGround: s.onGround,
    yaw: s.yaw,
    pitch: s.pitch,
    weapon: { ...s.weapon },
  };
}

export interface SimStepResult {
  weapon: WeaponStepResult;
  /** Ângulos efetivos usados para o disparo. */
  yaw: number;
  pitch: number;
}

/** Aplica um comando (SIM_DT) ao estado. Mesma função no cliente e no servidor. */
export function applyCommand(world: CollisionWorld, s: PlayerSimState, cmd: InputCmd): SimStepResult {
  s.yaw = cmd.yaw;
  s.pitch = clamp(cmd.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  const def = WEAPONS[s.weapon.id];
  stepMovement(world, s, cmd.buttons, s.yaw, SIM_DT, { speedMult: def.speedMult });
  const weapon = stepWeapon(s.weapon, cmd.buttons, SIM_DT, {
    horizontalSpeed: horizontalSpeed(s),
    onGround: s.onGround,
    sprinting: (cmd.buttons & Buttons.Sprint) !== 0,
    walkSpeed: WALK_SPEED,
  });
  return { weapon, yaw: s.yaw, pitch: s.pitch };
}

export const eyePosition = (pos: Vec3): Vec3 => ({ x: pos.x, y: pos.y + EYE_HEIGHT, z: pos.z });

// ---- Hitboxes ----
export type HitZone = 'head' | 'body' | 'legs';
export interface Hitbox {
  zone: HitZone;
  box: AABB;
}

const HEAD_HALF = 0.14;
const BODY_HALF = 0.25;
const LEGS_HALF = 0.2;
const HEAD_CENTER = PLAYER_HEIGHT - 0.14;
const BODY_BOTTOM = 0.86;
const BODY_TOP = PLAYER_HEIGHT - 0.28;

/** Hitboxes por região do corpo, a partir da posição dos pés. */
export function hitboxesAt(p: Vec3): Hitbox[] {
  const box = (h: number, y0: number, y1: number): AABB => ({
    min: { x: p.x - h, y: p.y + y0, z: p.z - h },
    max: { x: p.x + h, y: p.y + y1, z: p.z + h },
  });
  return [
    { zone: 'head', box: box(HEAD_HALF, HEAD_CENTER - HEAD_HALF, HEAD_CENTER + HEAD_HALF) },
    { zone: 'body', box: box(BODY_HALF, BODY_BOTTOM, BODY_TOP) },
    { zone: 'legs', box: box(LEGS_HALF, 0, BODY_BOTTOM) },
  ];
}
