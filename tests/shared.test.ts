import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  Buttons,
  createSimState,
  createWeaponState,
  dirFromAngles,
  FOUNDRY,
  getCollisionWorld,
  hitboxesAt,
  JUMP_VELOCITY,
  GRAVITY,
  playerAABB,
  rayAABB,
  sanitizeCode,
  sanitizeName,
  shotDirection,
  SIM_DT,
  stepWeapon,
  validateCmdBatch,
  WALK_SPEED,
  WEAPONS,
  type InputCmd,
} from '@nullpoint/shared';

const world = getCollisionWorld('foundry');
let seq = 0;
const cmd = (buttons: number, yaw = 0, pitch = 0): InputCmd => ({ seq: seq++, buttons, yaw, pitch, viewTime: 0 });
const ctx = { horizontalSpeed: 0, onGround: true, sprinting: false, walkSpeed: WALK_SPEED };

describe('mapa', () => {
  it('nenhum ponto de spawn está dentro da geometria e todos pousam no chão', () => {
    expect(FOUNDRY.spawns.length).toBeGreaterThanOrEqual(8);
    for (const sp of FOUNDRY.spawns) {
      expect(world.overlapsAny(playerAABB(sp.pos))).toBeNull();
      const s = createSimState(sp.pos, sp.yaw, 'warden');
      for (let i = 0; i < 30; i++) applyCommand(world, s, cmd(0, sp.yaw));
      expect(s.onGround).toBe(true);
      expect(s.pos.y).toBeCloseTo(0, 3);
    }
  });
});

describe('movimentação', () => {
  it('acelera até a velocidade de caminhada', () => {
    const s = createSimState({ x: -10, y: 0, z: -22.5 }, -Math.PI / 2, 'warden');
    for (let i = 0; i < 60; i++) applyCommand(world, s, cmd(Buttons.Forward, -Math.PI / 2));
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeGreaterThan(WALK_SPEED * 0.95);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeLessThanOrEqual(WALK_SPEED + 1e-6);
    expect(s.pos.x).toBeGreaterThan(-7);
  });

  it('para ao encostar na parede perimetral', () => {
    const s = createSimState({ x: 0, y: 0, z: -22.5 }, 0, 'warden'); // olhando para -Z (parede)
    for (let i = 0; i < 120; i++) applyCommand(world, s, cmd(Buttons.Forward, 0));
    expect(s.pos.z).toBeGreaterThan(-25);
    expect(s.pos.z).toBeCloseTo(-25 + 0.35, 2);
  });

  it('sobe as escadas da plataforma central', () => {
    const s = createSimState({ x: 0, y: 0, z: 9 }, 0, 'warden'); // olhando para -Z (plataforma)
    for (let i = 0; i < 180; i++) applyCommand(world, s, cmd(Buttons.Forward, 0));
    expect(s.pos.y).toBeGreaterThan(1.69);
  });

  it('pulo atinge a altura física esperada', () => {
    const s = createSimState({ x: -10, y: 0, z: -22.5 }, 0, 'warden');
    applyCommand(world, s, cmd(0));
    let maxY = 0;
    applyCommand(world, s, cmd(Buttons.Jump));
    for (let i = 0; i < 90; i++) {
      applyCommand(world, s, cmd(0));
      maxY = Math.max(maxY, s.pos.y);
    }
    const expected = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
    expect(maxY).toBeGreaterThan(expected * 0.9);
    expect(maxY).toBeLessThan(expected * 1.05);
    expect(s.onGround).toBe(true);
  });
});

describe('pistola', () => {
  const def = WEAPONS.warden;

  it('semiautomática: segurar o gatilho dispara apenas uma vez', () => {
    const ws = createWeaponState('warden');
    ws.drawLeft = 0;
    let shots = 0;
    for (let i = 0; i < 120; i++) if (stepWeapon(ws, Buttons.Fire, SIM_DT, ctx).fired) shots++;
    expect(shots).toBe(1);
  });

  it('respeita a cadência mesmo clicando a cada quadro', () => {
    const ws = createWeaponState('warden');
    ws.drawLeft = 0;
    let shots = 0;
    for (let i = 0; i < 60; i++) if (stepWeapon(ws, i % 2 ? 0 : Buttons.Fire, SIM_DT, ctx).fired) shots++;
    expect(shots).toBeLessThanOrEqual(Math.ceil(1 / def.fireInterval) + 1);
    expect(shots).toBeGreaterThanOrEqual(5);
  });

  it('recarrega automaticamente ao esvaziar e consome a reserva', () => {
    const ws = createWeaponState('warden');
    ws.drawLeft = 0;
    for (let i = 0; i < 2000 && ws.ammo > 0; i++) stepWeapon(ws, i % 2 ? 0 : Buttons.Fire, SIM_DT, ctx);
    expect(ws.ammo).toBe(0);
    for (let i = 0; i < 20; i++) stepWeapon(ws, i % 2 ? 0 : Buttons.Fire, SIM_DT, ctx);
    expect(ws.reloadLeft).toBeGreaterThan(0);
    for (let i = 0; i < Math.ceil(def.reloadTime / SIM_DT) + 2; i++) stepWeapon(ws, 0, SIM_DT, ctx);
    expect(ws.ammo).toBe(def.magSize);
    expect(ws.reserve).toBe(def.reserve - def.magSize);
  });

  it('dispersão é determinística e zero dispersão segue a mira', () => {
    const a = shotDirection(0.3, 0.1, 0.05, 7, 3);
    const b = shotDirection(0.3, 0.1, 0.05, 7, 3);
    expect(a).toEqual(b);
    const c = shotDirection(0.3, 0.1, 0, 7, 3);
    const f = dirFromAngles(0.3, 0.1);
    expect(c.x).toBeCloseTo(f.x, 9);
    expect(c.y).toBeCloseTo(f.y, 9);
    expect(c.z).toBeCloseTo(f.z, 9);
  });

  it('headshot elimina com um tiro; tronco precisa de 4', () => {
    expect(def.damage * def.headMult).toBeGreaterThanOrEqual(100);
    expect(Math.ceil(100 / def.damage)).toBe(4);
  });
});

describe('raycast e hitboxes', () => {
  it('rayAABB acerta a caixa à frente e ignora a de trás', () => {
    const box = { min: { x: -1, y: -1, z: -6 }, max: { x: 1, y: 1, z: -4 } };
    expect(rayAABB({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, box)).toBeCloseTo(4);
    expect(rayAABB({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, box)).toBe(-1);
  });

  it('hitbox da cabeça fica na altura dos olhos', () => {
    const head = hitboxesAt({ x: 0, y: 0, z: 0 }).find((h) => h.zone === 'head')!;
    expect(head.box.min.y).toBeLessThan(1.62);
    expect(head.box.max.y).toBeGreaterThan(1.62);
  });

  it('paredes bloqueiam o raycast do mundo', () => {
    const hit = world.raycast({ x: 0, y: 1.6, z: -20 }, { x: 0, y: 0, z: -1 }, 100);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(5, 3);
  });
});

describe('validação de payloads', () => {
  it('rejeita comandos malformados', () => {
    expect(validateCmdBatch([])).toBeNull();
    expect(validateCmdBatch('x')).toBeNull();
    expect(validateCmdBatch([{ seq: 1, buttons: 1 << 12, yaw: 0, pitch: 0, viewTime: 0 }])).toBeNull();
    expect(validateCmdBatch([{ seq: 1, buttons: 0, yaw: NaN, pitch: 0, viewTime: 0 }])).toBeNull();
    expect(validateCmdBatch(new Array(40).fill({ seq: 1, buttons: 0, yaw: 0, pitch: 0, viewTime: 0 }))).toBeNull();
    expect(validateCmdBatch([{ seq: 1, buttons: 3, yaw: 0.5, pitch: 0.1, viewTime: 10 }])).toHaveLength(1);
  });
  it('sanitiza nomes e códigos', () => {
    expect(sanitizeName('  <b>Lu\u0000cas</b>  ')).toBe('bLucas/b');
    expect(sanitizeName('a')).toBeNull();
    expect(sanitizeCode('ab3k9z')).toBe('AB3K9Z');
    expect(sanitizeCode('AB0K9Z')).toBeNull(); // 0 não faz parte do alfabeto
  });
});
