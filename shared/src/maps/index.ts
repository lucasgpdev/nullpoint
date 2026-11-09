import { CollisionWorld } from '../collision';
import { FOUNDRY } from './foundry';
import type { MapDef } from './types';

export * from './types';
export { FOUNDRY } from './foundry';

export const MAPS: Record<string, MapDef> = { [FOUNDRY.id]: FOUNDRY };
export const DEFAULT_MAP = FOUNDRY.id;

const worlds = new Map<string, CollisionWorld>();
export function getCollisionWorld(mapId: string): CollisionWorld {
  let w = worlds.get(mapId);
  if (!w) {
    const def = MAPS[mapId];
    if (!def) throw new Error(`Mapa desconhecido: ${mapId}`);
    w = new CollisionWorld(def.boxes);
    worlds.set(mapId, w);
  }
  return w;
}
