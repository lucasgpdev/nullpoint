/**
 * FOUNDRY YARD — arena da Fase 1.
 * Pátio de fundição 50×50 m com plataforma central elevada, contêineres, caixas e dois galpões cobertos.
 * O layout tem simetria rotacional de 180° para equilibrar os lados.
 */
import type { MapBox, MapDef, SpawnPoint, SurfaceMaterial } from './types';

const B = (
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  mat: SurfaceMaterial, castShadow = true,
): MapBox => ({
  min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
  max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
  mat,
  castShadow,
});

/** Espelha um bloco pela rotação de 180° em torno do eixo Y. */
const mirror = (b: MapBox): MapBox => ({
  min: { x: -b.max.x, y: b.min.y, z: -b.max.z },
  max: { x: -b.min.x, y: b.max.y, z: -b.min.z },
  mat: b.mat,
  castShadow: b.castShadow,
});

const S = 25; // meia largura
const WALL_H = 7;

const symmetric: MapBox[] = [
  B(-26, -1, -26, 26, 0, 26, 'floor', false),
  // Paredes perimetrais
  B(-S - 1, 0, -S - 1, S + 1, WALL_H, -S, 'wall'),
  B(-S - 1, 0, S, S + 1, WALL_H, S + 1, 'wall'),
  B(-S - 1, 0, -S, -S, WALL_H, S, 'wall'),
  B(S, 0, -S, S + 1, WALL_H, S, 'wall'),
  // Plataforma central
  B(-4, 0, -4, 4, 1.6, 4, 'concrete'),
  B(-4.1, 1.6, -4.1, 4.1, 1.7, 4.1, 'trim'),
  // Pilar central (bloqueia a linha de visão diagonal)
  B(-0.6, 1.7, -0.6, 0.6, 4.2, 0.6, 'metal'),
];

const half: MapBox[] = [
  // Escadas da plataforma (lado +Z)
  B(-1.6, 0, 4, 1.6, 1.2, 5, 'concrete'),
  B(-1.6, 0, 5, 1.6, 0.8, 6, 'concrete'),
  B(-1.6, 0, 6, 1.6, 0.4, 7, 'concrete'),
  // Coberturas baixas sobre a plataforma
  B(-4, 1.7, 2.6, -2.2, 2.75, 3.4, 'metal'),
  B(2.4, 1.7, -0.4, 3.2, 2.75, 1.6, 'metal'),

  // Contêineres
  B(-14, 0, 6, -11.6, 2.6, 12, 'containerA'),
  B(-20.5, 0, 15, -14.5, 2.6, 17.4, 'containerB'),
  B(-20.5, 2.6, 15.2, -15.5, 5.2, 17.4, 'containerA'),
  B(6, 0, 13, 8.4, 2.6, 19, 'containerB'),

  // Caixas
  B(-9.2, 0, 9, -8, 1.2, 10.2, 'crate'),
  B(-8, 0, 9.4, -7, 1.0, 10.4, 'crate'),
  B(-9.0, 1.2, 9.2, -8.1, 2.1, 10.1, 'crate'),
  B(-4.5, 0, 14, -3.3, 1.2, 15.2, 'crate'),
  B(1, 0, 9, 2.2, 1.2, 10.2, 'crate'),
  B(13, 0, 20, 14.2, 1.2, 21.2, 'crate'),
  B(14.2, 0, 20.2, 15.2, 1.0, 21.2, 'crate'),
  B(-22.5, 0, 21, -21.3, 1.2, 22.2, 'crate'),

  // Pilares e muretas
  B(-12.5, 0, -1, -11.5, 5, 1, 'concrete'),
  B(10.5, 0, 6.5, 13.5, 1.1, 7.2, 'concrete'),
  B(-3, 0, 19.5, 3, 1.1, 20.2, 'concrete'),

  // Galpão coberto (lado -X)
  B(-18.5, 0, -6.5, -18, 4, -2.5, 'wall'),
  B(-18.5, 0, 2.5, -18, 4, 6.5, 'wall'),
  B(-18.5, 0, -2.5, -18, 1.1, 2.5, 'wall'), // janela: parte baixa
  B(-18.5, 2.5, -2.5, -18, 4, 2.5, 'wall'), // janela: parte alta
  B(-25, 0, -6.5, -21.2, 4, -6, 'wall'),
  B(-25, 0, 6, -21.2, 4, 6.5, 'wall'),
  B(-25, 4, -6.5, -18, 4.4, 6.5, 'roof'),
  B(-24.2, 0, -1.6, -23, 1.2, -0.4, 'crate'),
];

export const FOUNDRY_SPAWNS: SpawnPoint[] = (
  [
    [-21, -21],
    [-8, -21],
    [-22, 0],
    [-21, 12],
    [-6, 22.5],
    [9, 9],
    [17, 23],
    [-15, -9],
  ] as const
)
  .flatMap(([x, z]) => [
    { x, z },
    { x: -x, z: -z },
  ])
  .map(({ x, z }) => ({ pos: { x, y: 0.05, z }, yaw: Math.atan2(x, z) }));

export const FOUNDRY: MapDef = {
  id: 'foundry',
  name: 'FOUNDRY YARD',
  subtitle: 'Arena · Mata-mata',
  bounds: { min: { x: -S, y: -1, z: -S }, max: { x: S, y: 12, z: S } },
  boxes: [...symmetric, ...half, ...half.map(mirror)],
  spawns: FOUNDRY_SPAWNS,
  lights: [
    { pos: { x: -21.5, y: 3.7, z: 0 }, color: 0xffb36b, intensity: 14, distance: 12 },
    { pos: { x: 21.5, y: 3.7, z: 0 }, color: 0xffb36b, intensity: 14, distance: 12 },
    { pos: { x: 0, y: 4.6, z: 0 }, color: 0x9fd8ff, intensity: 10, distance: 10 },
  ],
  sky: { top: 0x26313d, bottom: 0xc9a27e, fog: 0x8d8478, fogNear: 30, fogFar: 110 },
  sun: { dir: { x: -0.55, y: -1, z: -0.35 }, color: 0xffe2bf, intensity: 2.6 },
};
