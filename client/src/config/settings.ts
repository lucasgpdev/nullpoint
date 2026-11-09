export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  name: string;
  sensitivity: number; // multiplicador (1 = 0,0022 rad por pixel)
  fov: number;
  masterVolume: number;
  sfxVolume: number;
  quality: Quality;
  showFps: boolean;
  invertY: boolean;
}

const KEY = 'nullpoint.settings.v1';
const DEFAULTS: Settings = {
  name: '',
  sensitivity: 1,
  fov: 90,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  quality: 'medium',
  showFps: true,
  invertY: false,
};

export interface QualityPreset {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  normalMaps: boolean;
  antialias: boolean;
  anisotropy: number;
  maxDecals: number;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 0.75, shadows: false, shadowMapSize: 512, normalMaps: false, antialias: false, anisotropy: 1, maxDecals: 24 },
  medium: { pixelRatio: 1, shadows: true, shadowMapSize: 1024, normalMaps: true, antialias: true, anisotropy: 4, maxDecals: 64 },
  high: { pixelRatio: 2, shadows: true, shadowMapSize: 2048, normalMaps: true, antialias: true, anisotropy: 8, maxDecals: 128 },
};

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* armazenamento indisponível: usa padrões */
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignora */
  }
  listeners.forEach((l) => l(settings));
}

export function onSettingsChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
