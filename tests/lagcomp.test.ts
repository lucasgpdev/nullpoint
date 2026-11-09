import { describe, expect, it } from 'vitest';
import { getCollisionWorld, WEAPONS } from '@nullpoint/shared';
import { LagCompensation } from '../server/src/combat/LagCompensation';
import { hitscan } from '../server/src/combat/hitscan';

describe('compensação de latência', () => {
  const world = getCollisionWorld('foundry');
  const def = WEAPONS.warden;

  it('acerta o alvo onde o atirador o via, não onde ele está agora', () => {
    const lag = new LagCompensation();
    // Alvo cruza a linha de tiro: de z = -24 para z = -21 (em x = -2) entre t=1000 e t=1400
    for (let t = 1000; t <= 1400; t += 16) {
      const z = -24 + ((t - 1000) / 400) * 3;
      lag.record(t, [{ id: 2, pos: { x: -2, y: 0, z }, alive: true }]);
    }
    const now = 1400;
    const viewTime = 1200; // atirador com ~200 ms de atraso via o alvo em x = -2
    const t = lag.clampTime(viewTime, now);
    const past = lag.positionAt(2, t)!;
    expect(past.z).toBeCloseTo(-22.5, 1);

    const origin = { x: -12, y: 1.62, z: -22.5 };
    const aimAt = { x: -2, y: 1.2, z: -22.5 };
    const d = { x: aimAt.x - origin.x, y: aimAt.y - origin.y, z: aimAt.z - origin.z };
    const l = Math.hypot(d.x, d.y, d.z);
    const dir = { x: d.x / l, y: d.y / l, z: d.z / l };

    const rewound = hitscan(world, origin, dir, def, [{ id: 2, pos: past }]);
    expect(rewound.victim).toBe(2);
    const current = hitscan(world, origin, dir, def, [{ id: 2, pos: lag.positionAt(2, now)! }]);
    expect(current.victim).toBeUndefined();
  });

  it('limita a rebobinagem a 250 ms', () => {
    const lag = new LagCompensation();
    expect(lag.clampTime(0, 10_000)).toBe(9_750);
    expect(lag.clampTime(20_000, 10_000)).toBe(10_000);
  });

  it('parede entre atirador e alvo bloqueia o tiro', () => {
    // Atirador dentro do galpão (-X), alvo do outro lado da parede lateral do galpão
    const origin = { x: -22, y: 1.62, z: -3 };
    const target = { x: -22, y: 0, z: -9 };
    const dir = { x: 0, y: -0.07, z: -1 };
    const l = Math.hypot(dir.x, dir.y, dir.z);
    const r = hitscan(world, origin, { x: dir.x / l, y: dir.y / l, z: dir.z / l }, def, [{ id: 3, pos: target }]);
    expect(r.victim).toBeUndefined();
  });
});
