import {
  AIR_ACCEL,
  FRICTION,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_VELOCITY,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SNAP_DOWN,
  SPRINT_SPEED,
  STEP_HEIGHT,
  STOP_SPEED,
  WALK_SPEED,
} from './constants';
import { aabbOverlap, CollisionWorld, EPS, type AABB } from './collision';
import { forwardFromYaw, rightFromYaw, type Vec3 } from './math';
import { Buttons } from './protocol';

export interface Kinematics {
  pos: Vec3; // centro dos pés
  vel: Vec3;
  onGround: boolean;
}

export function playerAABB(pos: Vec3, out?: AABB): AABB {
  const b = out ?? { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  b.min.x = pos.x - PLAYER_RADIUS;
  b.min.y = pos.y;
  b.min.z = pos.z - PLAYER_RADIUS;
  b.max.x = pos.x + PLAYER_RADIUS;
  b.max.y = pos.y + PLAYER_HEIGHT;
  b.max.z = pos.z + PLAYER_RADIUS;
  return b;
}

const tmpBox: AABB = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
const candidates: AABB[] = [];

function collidesAt(world: CollisionWorld, pos: Vec3): AABB | null {
  return world.overlapsAny(playerAABB(pos, tmpBox));
}

/** Move em um eixo horizontal, resolvendo colisões e subindo degraus quando possível. */
function moveHorizontal(world: CollisionWorld, k: Kinematics, axis: 'x' | 'z', delta: number) {
  if (delta === 0) return;
  k.pos[axis] += delta;
  const box = playerAABB(k.pos, tmpBox);
  world.query(
    {
      min: { x: box.min.x - 0.1, y: box.min.y - 0.1, z: box.min.z - 0.1 },
      max: { x: box.max.x + 0.1, y: box.max.y + 0.1, z: box.max.z + 0.1 },
    },
    candidates,
  );
  for (const b of candidates) {
    playerAABB(k.pos, tmpBox);
    if (!aabbOverlap(tmpBox, b)) continue;
    // Degrau: obstáculo baixo e espaço livre acima dele.
    const rise = b.max.y - k.pos.y;
    if (k.onGround && rise > 0 && rise <= STEP_HEIGHT) {
      const lifted = { x: k.pos.x, y: b.max.y + EPS, z: k.pos.z };
      if (!collidesAt(world, lifted)) {
        k.pos.y = lifted.y;
        continue;
      }
    }
    if (delta > 0) k.pos[axis] = b.min[axis] - PLAYER_RADIUS - EPS;
    else k.pos[axis] = b.max[axis] + PLAYER_RADIUS + EPS;
    k.vel[axis] = 0;
  }
}

function moveVertical(world: CollisionWorld, k: Kinematics, delta: number) {
  k.onGround = false;
  if (delta === 0) return;
  k.pos.y += delta;
  const box = playerAABB(k.pos, tmpBox);
  world.query(box, candidates);
  for (const b of candidates) {
    playerAABB(k.pos, tmpBox);
    if (!aabbOverlap(tmpBox, b)) continue;
    if (delta < 0) {
      k.pos.y = b.max.y;
      k.onGround = true;
    } else {
      k.pos.y = b.min.y - PLAYER_HEIGHT - EPS;
    }
    k.vel.y = 0;
  }
}

/** Integra movimento com sub-passos para evitar atravessar paredes finas. */
function integrate(world: CollisionWorld, k: Kinematics, dt: number) {
  const wasGround = k.onGround;
  const maxStep = PLAYER_RADIUS * 0.6;
  const dist = Math.max(Math.abs(k.vel.x), Math.abs(k.vel.y), Math.abs(k.vel.z)) * dt;
  const steps = Math.max(1, Math.ceil(dist / maxStep));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    moveHorizontal(world, k, 'x', k.vel.x * sdt);
    moveHorizontal(world, k, 'z', k.vel.z * sdt);
    const ground = k.onGround;
    moveVertical(world, k, k.vel.y * sdt);
    // Mantém o contato com o chão ao descer degraus/rampas curtas.
    if (!k.onGround && ground && wasGround && k.vel.y <= 0) {
      const probe = { x: k.pos.x, y: k.pos.y - SNAP_DOWN, z: k.pos.z };
      playerAABB(probe, tmpBox);
      tmpBox.max.y = k.pos.y; // apenas a faixa abaixo dos pés
      const hit = world.query(tmpBox, candidates).filter((b) => aabbOverlap(tmpBox, b));
      if (hit.length) {
        k.pos.y = Math.max(...hit.map((b) => b.max.y));
        k.onGround = true;
        k.vel.y = 0;
      }
    }
  }
}

function applyFriction(vel: Vec3, dt: number) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 1e-4) {
    vel.x = 0;
    vel.z = 0;
    return;
  }
  const control = speed < STOP_SPEED ? STOP_SPEED : speed;
  const drop = control * FRICTION * dt;
  const ns = Math.max(0, speed - drop) / speed;
  vel.x *= ns;
  vel.z *= ns;
}

function accelerate(vel: Vec3, wishX: number, wishZ: number, wishSpeed: number, accel: number, dt: number) {
  const current = vel.x * wishX + vel.z * wishZ;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const acc = Math.min(accel * wishSpeed * dt, add);
  vel.x += acc * wishX;
  vel.z += acc * wishZ;
}

export interface MoveParams {
  /** Multiplicador de velocidade da arma equipada. */
  speedMult: number;
}

/** Passo determinístico de movimento. Executado de forma idêntica no cliente (previsão) e no servidor. */
export function stepMovement(
  world: CollisionWorld,
  k: Kinematics,
  buttons: number,
  yaw: number,
  dt: number,
  params: MoveParams,
): void {
  let fm = 0;
  let sm = 0;
  if (buttons & Buttons.Forward) fm += 1;
  if (buttons & Buttons.Back) fm -= 1;
  if (buttons & Buttons.Right) sm += 1;
  if (buttons & Buttons.Left) sm -= 1;

  const f = forwardFromYaw(yaw);
  const r = rightFromYaw(yaw);
  let wx = f.x * fm + r.x * sm;
  let wz = f.z * fm + r.z * sm;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) {
    wx /= wl;
    wz /= wl;
  }
  const sprinting = (buttons & Buttons.Sprint) !== 0 && fm > 0;
  const wishSpeed = wl > 0 ? (sprinting ? SPRINT_SPEED : WALK_SPEED) * params.speedMult : 0;

  if (k.onGround) {
    if (buttons & Buttons.Jump) {
      k.vel.y = JUMP_VELOCITY;
      k.onGround = false;
      accelerate(k.vel, wx, wz, wishSpeed, AIR_ACCEL, dt);
    } else {
      applyFriction(k.vel, dt);
      accelerate(k.vel, wx, wz, wishSpeed, GROUND_ACCEL, dt);
    }
  } else {
    accelerate(k.vel, wx, wz, wishSpeed, AIR_ACCEL, dt);
  }

  k.vel.y -= GRAVITY * dt;
  integrate(world, k, dt);
}

export const horizontalSpeed = (k: Kinematics) => Math.hypot(k.vel.x, k.vel.z);
