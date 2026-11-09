import type { AABB } from '../collision';
import type { Vec3 } from '../math';

export type SurfaceMaterial =
  | 'floor'
  | 'wall'
  | 'concrete'
  | 'metal'
  | 'containerA'
  | 'containerB'
  | 'crate'
  | 'trim'
  | 'roof';

export interface MapBox extends AABB {
  mat: SurfaceMaterial;
  /** Se falso, o bloco não projeta sombra (ex.: piso). */
  castShadow?: boolean;
}

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
}

export interface LightLabel {
  pos: Vec3;
  color: number;
  intensity: number;
  distance: number;
}

/** Definição de mapa: a mesma lista de caixas gera a colisão (servidor/cliente) e a malha 3D (cliente). */
export interface MapDef {
  id: string;
  name: string;
  subtitle: string;
  bounds: AABB;
  boxes: MapBox[];
  spawns: SpawnPoint[];
  lights: LightLabel[];
  sky: { top: number; bottom: number; fog: number; fogNear: number; fogFar: number };
  sun: { dir: Vec3; color: number; intensity: number };
}
