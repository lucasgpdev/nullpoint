/**
 * Texturas procedurais (albedo + normal) geradas em canvas.
 * São originais e não dependem de arquivos externos; podem ser trocadas por texturas PBR exportadas
 * do Blender/Substance mantendo os mesmos nomes de material.
 */
import * as THREE from 'three';
import { mulberry32 } from '@nullpoint/shared';

const SIZE = 512;

function canvas(size = SIZE): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Ruído de valor tileável em múltiplas oitavas. */
function noiseField(size: number, seed: number, octaves = 5): Float32Array {
  const out = new Float32Array(size * size);
  const rng = mulberry32(seed);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = 4 << o;
    const grid = new Float32Array(cells * cells).map(() => rng());
    const step = size / cells;
    for (let y = 0; y < size; y++) {
      const gy = y / step;
      const y0 = Math.floor(gy) % cells;
      const y1 = (y0 + 1) % cells;
      const fy = gy - Math.floor(gy);
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const gx = x / step;
        const x0 = Math.floor(gx) % cells;
        const x1 = (x0 + 1) % cells;
        const fx = gx - Math.floor(gx);
        const sx = fx * fx * (3 - 2 * fx);
        const a = grid[y0 * cells + x0] + (grid[y0 * cells + x1] - grid[y0 * cells + x0]) * sx;
        const b = grid[y1 * cells + x0] + (grid[y1 * cells + x1] - grid[y1 * cells + x0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

interface TexSpec {
  albedo: (ctx: CanvasRenderingContext2D, h: Float32Array, size: number) => void;
  /** Altura em 0..1 para gerar o normal map. */
  height: (x: number, y: number, n: number) => number;
  normalStrength: number;
  seed: number;
}

function heightToNormal(heights: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const h = (x: number, y: number) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

function build(spec: TexSpec, normalMaps: boolean, anisotropy: number) {
  const n = noiseField(SIZE, spec.seed);
  const [c, ctx] = canvas();
  spec.albedo(ctx, n, SIZE);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = anisotropy;
  let normalMap: THREE.Texture | undefined;
  if (normalMaps) {
    const hs = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) hs[y * SIZE + x] = spec.height(x, y, n[y * SIZE + x]);
    normalMap = new THREE.CanvasTexture(heightToNormal(hs, SIZE, spec.normalStrength));
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.anisotropy = anisotropy;
  }
  return { map, normalMap };
}

/** Pinta pixel a pixel a partir do ruído. */
function paint(ctx: CanvasRenderingContext2D, size: number, fn: (x: number, y: number) => [number, number, number]) {
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

const tint = (base: [number, number, number], v: number): [number, number, number] => [
  Math.min(255, base[0] * v),
  Math.min(255, base[1] * v),
  Math.min(255, base[2] * v),
];

export type TexName = 'floor' | 'wall' | 'concrete' | 'metal' | 'corrugated' | 'crate' | 'hazard' | 'roof';

const specs: Record<TexName, TexSpec> = {
  floor: {
    seed: 11,
    normalStrength: 2.2,
    albedo: (ctx, n, s) => {
      // Placas de concreto 2×2 m (a textura cobre 4 m)
      paint(ctx, s, (x, y) => {
        const v = n[y * s + x];
        const seam = x % (s / 2) < 3 || y % (s / 2) < 3 ? 0.55 : 1;
        const stain = 0.82 + v * 0.35;
        return tint([150, 144, 134], stain * seam);
      });
    },
    height: (x, y, v) => (x % (SIZE / 2) < 3 || y % (SIZE / 2) < 3 ? 0 : 0.6 + v * 0.25),
  },
  wall: {
    seed: 23,
    normalStrength: 2.5,
    albedo: (ctx, n, s) => {
      paint(ctx, s, (x, y) => {
        const v = n[y * s + x];
        const row = Math.floor(y / (s / 8));
        const off = row % 2 ? s / 8 : 0;
        const mortar = y % (s / 8) < 4 || (x + off) % (s / 4) < 4;
        return tint([124, 120, 114], mortar ? 0.6 : 0.85 + v * 0.3);
      });
    },
    height: (x, y, v) => {
      const row = Math.floor(y / (SIZE / 8));
      const off = row % 2 ? SIZE / 8 : 0;
      return y % (SIZE / 8) < 4 || (x + off) % (SIZE / 4) < 4 ? 0 : 0.7 + v * 0.2;
    },
  },
  concrete: {
    seed: 37,
    normalStrength: 1.6,
    albedo: (ctx, n, s) => paint(ctx, s, (x, y) => tint([168, 162, 152], 0.78 + n[y * s + x] * 0.4)),
    height: (_x, _y, v) => v,
  },
  metal: {
    seed: 41,
    normalStrength: 1.4,
    albedo: (ctx, n, s) =>
      paint(ctx, s, (x, y) => {
        const panel = x % (s / 2) < 2 || y % (s / 2) < 2 ? 0.5 : 1;
        return tint([96, 102, 110], (0.8 + n[y * s + x] * 0.35) * panel);
      }),
    height: (x, y, v) => (x % (SIZE / 2) < 2 || y % (SIZE / 2) < 2 ? 0 : 0.5 + v * 0.1),
  },
  corrugated: {
    seed: 53,
    normalStrength: 5,
    albedo: (ctx, n, s) =>
      paint(ctx, s, (x, y) => {
        const rib = 0.82 + 0.18 * Math.sin((x / s) * Math.PI * 2 * 16);
        const rust = n[y * s + x] > 0.62 ? 0.75 : 1;
        return tint([255, 255, 255], rib * rust * (0.9 + n[y * s + x] * 0.15));
      }),
    height: (x) => 0.5 + 0.5 * Math.sin((x / SIZE) * Math.PI * 2 * 16),
  },
  crate: {
    seed: 67,
    normalStrength: 3,
    albedo: (ctx, n, s) =>
      paint(ctx, s, (x, y) => {
        const edge = x < s * 0.08 || x > s * 0.92 || y < s * 0.08 || y > s * 0.92;
        const diag = Math.abs(x - y) < s * 0.05 || Math.abs(x + y - s) < s * 0.05;
        const v = 0.8 + n[y * s + x] * 0.3;
        return edge || diag ? tint([66, 72, 58], v) : tint([92, 104, 76], v);
      }),
    height: (x, y) => {
      const s = SIZE;
      const edge = x < s * 0.08 || x > s * 0.92 || y < s * 0.08 || y > s * 0.92;
      const diag = Math.abs(x - y) < s * 0.05 || Math.abs(x + y - s) < s * 0.05;
      return edge || diag ? 1 : 0.4;
    },
  },
  hazard: {
    seed: 71,
    normalStrength: 0.8,
    albedo: (ctx, n, s) =>
      paint(ctx, s, (x, y) => {
        const stripe = Math.floor((x + y) / (s / 8)) % 2 === 0;
        const v = 0.75 + n[y * s + x] * 0.35;
        return stripe ? tint([232, 176, 32], v) : tint([30, 30, 32], v);
      }),
    height: (_x, _y, v) => v * 0.3,
  },
  roof: {
    seed: 83,
    normalStrength: 4,
    albedo: (ctx, n, s) =>
      paint(ctx, s, (x, y) => tint([70, 74, 80], (0.85 + 0.15 * Math.sin((x / s) * Math.PI * 24)) * (0.8 + n[y * s + x] * 0.3))),
    height: (x) => 0.5 + 0.5 * Math.sin((x / SIZE) * Math.PI * 24),
  },
};

const cache = new Map<string, { map: THREE.Texture; normalMap?: THREE.Texture }>();

export function getTexture(name: TexName, normalMaps: boolean, anisotropy: number) {
  const key = `${name}:${normalMaps}:${anisotropy}`;
  let t = cache.get(key);
  if (!t) {
    t = build(specs[name], normalMaps, anisotropy);
    cache.set(key, t);
  }
  return t;
}

/** Textura de texto (placas, numeração de contêineres). */
export function labelTexture(text: string, fg = '#e9e4d8', bg = 'rgba(0,0,0,0)', w = 512, h = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `700 ${Math.floor(h * 0.72)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + h * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
