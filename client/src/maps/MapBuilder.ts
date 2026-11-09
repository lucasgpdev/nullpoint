import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, type MapBox, type MapDef, type SurfaceMaterial } from '@nullpoint/shared';
import type { QualityPreset } from '../config/settings';
import { getTexture, labelTexture, type TexName } from './textures';

interface MatSpec {
  tex: TexName;
  /** metros por repetição da textura (modo mundo) ou null para UV por caixa */
  scale: number | null;
  color: number;
  roughness: number;
  metalness: number;
}

const MATS: Record<SurfaceMaterial, MatSpec> = {
  floor: { tex: 'floor', scale: 4, color: 0xa8a39a, roughness: 0.94, metalness: 0 },
  wall: { tex: 'wall', scale: 4, color: 0xf2ece4, roughness: 0.9, metalness: 0 },
  concrete: { tex: 'concrete', scale: 3, color: 0xb9b3a8, roughness: 0.88, metalness: 0 },
  metal: { tex: 'metal', scale: 2, color: 0xffffff, roughness: 0.42, metalness: 0.65 },
  containerA: { tex: 'corrugated', scale: 2.4, color: 0xb64b24, roughness: 0.62, metalness: 0.35 },
  containerB: { tex: 'corrugated', scale: 2.4, color: 0x2c6a74, roughness: 0.62, metalness: 0.35 },
  crate: { tex: 'crate', scale: null, color: 0xffffff, roughness: 0.8, metalness: 0.1 },
  trim: { tex: 'hazard', scale: 1, color: 0xffffff, roughness: 0.7, metalness: 0.1 },
  roof: { tex: 'roof', scale: 3, color: 0xffffff, roughness: 0.55, metalness: 0.5 },
};

/** Caixa com UVs em coordenadas de mundo (densidade de texel uniforme, sem esticar). */
function boxGeometry(b: MapBox, scale: number | null): THREE.BufferGeometry {
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
  if (scale !== null) {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (ny > 0.5) uv.setXY(i, x / scale, z / scale);
      else if (nx > 0.5) uv.setXY(i, z / scale, y / scale);
      else uv.setXY(i, x / scale, y / scale);
    }
  }
  return g;
}

export interface BuiltMap {
  group: THREE.Group;
  lights: THREE.PointLight[];
  sun: THREE.DirectionalLight;
  dispose(): void;
}

export function buildMap(def: MapDef, quality: QualityPreset): BuiltMap {
  const group = new THREE.Group();
  group.name = `map:${def.id}`;
  const disposables: { dispose(): void }[] = [];

  // ---- Geometria jogável (mesma lista de caixas da colisão) agrupada por material ----
  const byMat = new Map<SurfaceMaterial, { cast: THREE.BufferGeometry[]; noCast: THREE.BufferGeometry[] }>();
  for (const b of def.boxes) {
    let e = byMat.get(b.mat);
    if (!e) byMat.set(b.mat, (e = { cast: [], noCast: [] }));
    (b.castShadow === false ? e.noCast : e.cast).push(boxGeometry(b, MATS[b.mat].scale));
  }
  for (const [mat, lists] of byMat) {
    const spec = MATS[mat];
    const tex = getTexture(spec.tex, quality.normalMaps, quality.anisotropy);
    const material = new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap ?? null,
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
    });
    if (tex.normalMap) material.normalScale.set(0.8, 0.8);
    disposables.push(material);
    for (const [geos, cast] of [[lists.cast, true], [lists.noCast, false]] as const) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = cast && quality.shadows;
      mesh.receiveShadow = quality.shadows;
      mesh.name = `map:${mat}`;
      group.add(mesh);
      disposables.push(merged);
    }
  }

  decorate(def, group, disposables);

  // ---- Céu em gradiente ----
  const skyGeo = new THREE.SphereGeometry(400, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(def.sky.top) }, bottom: { value: new THREE.Color(def.sky.bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); vec3 c = mix(bottom, top, pow(h,0.8)); gl_FragColor = vec4(c,1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  group.add(sky);
  disposables.push(skyGeo, skyMat);

  // ---- Iluminação ----
  const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x4a3e34, 0.85);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(def.sun.color, def.sun.intensity);
  const d = new THREE.Vector3(def.sun.dir.x, def.sun.dir.y, def.sun.dir.z).normalize();
  sun.position.copy(d.clone().multiplyScalar(-60));
  sun.target.position.set(0, 0, 0);
  group.add(sun, sun.target);
  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -36;
    cam.right = cam.top = 36;
    cam.near = 1;
    cam.far = 140;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
  }
  const lights: THREE.PointLight[] = [];
  for (const l of def.lights) {
    const p = new THREE.PointLight(l.color, l.intensity, l.distance, 1.6);
    p.position.set(l.pos.x, l.pos.y, l.pos.z);
    group.add(p);
    lights.push(p);
  }

  return {
    group,
    lights,
    sun,
    dispose() {
      disposables.forEach((x) => x.dispose());
    },
  };
}

/** Elementos visuais sem colisão: identidade do mapa, iluminação aparente, horizonte. */
function decorate(def: MapDef, group: THREE.Group, disposables: { dispose(): void }[]) {
  const add = <T extends THREE.Object3D>(o: T) => {
    group.add(o);
    return o;
  };
  const rng = mulberry32(99);

  // Luminárias emissivas onde há luzes pontuais
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd6a0, emissiveIntensity: 3 });
  const lampGeo = new THREE.BoxGeometry(1.6, 0.08, 0.3);
  disposables.push(lampMat, lampGeo);
  for (const l of def.lights) {
    const m = add(new THREE.Mesh(lampGeo, lampMat));
    m.position.set(l.pos.x, l.pos.y + 0.25, l.pos.z);
    if (Math.abs(l.pos.x) > 10) m.rotation.y = Math.PI / 2;
  }

  // Tubulações ao longo das paredes norte e sul
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x6d7378, metalness: 0.8, roughness: 0.35 });
  const pipeGeo = new THREE.CylinderGeometry(0.18, 0.18, 50, 12);
  const bracketGeo = new THREE.BoxGeometry(0.12, 0.5, 0.5);
  disposables.push(pipeMat, pipeGeo, bracketGeo);
  for (const z of [-24.7, 24.7]) {
    for (const y of [5.4, 6.0]) {
      const p = add(new THREE.Mesh(pipeGeo, pipeMat));
      p.rotation.z = Math.PI / 2;
      p.position.set(0, y, z);
      p.castShadow = true;
    }
    for (let x = -22; x <= 22; x += 4) {
      const b = add(new THREE.Mesh(bracketGeo, pipeMat));
      b.position.set(x, 5.7, z);
    }
  }

  // Faixas de segurança no piso ao redor da plataforma
  const hazardMat = new THREE.MeshStandardMaterial({ color: 0xd9a21f, roughness: 0.85 });
  disposables.push(hazardMat);
  const stripe = (w: number, dd: number, x: number, z: number) => {
    const g = new THREE.PlaneGeometry(w, dd);
    disposables.push(g);
    const m = add(new THREE.Mesh(g, hazardMat));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    m.receiveShadow = true;
  };
  stripe(9.6, 0.25, 0, -4.6);
  stripe(9.6, 0.25, 0, 4.6);
  stripe(0.25, 9.4, -4.6, 0);
  stripe(0.25, 9.4, 4.6, 0);

  // Placas de setor
  const sign = (text: string, x: number, y: number, z: number, ry: number, w = 3.2, accent = '#ff5a1f') => {
    const tex = labelTexture(text, '#efe9dd', accent);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const g = new THREE.PlaneGeometry(w, w / 4);
    disposables.push(tex, mat, g);
    const m = add(new THREE.Mesh(g, mat));
    m.position.set(x, y, z);
    m.rotation.y = ry;
  };
  sign('SETOR A', -24.95, 3.2, 14, Math.PI / 2);
  sign('SETOR B', 24.95, 3.2, -14, -Math.PI / 2);
  sign('FOUNDRY YARD', 0, 4.6, -24.95, 0, 6, '#1c1f24');
  sign('FOUNDRY YARD', 0, 4.6, 24.95, Math.PI, 6, '#1c1f24');
  sign('GALPÃO 1', -17.98, 3.25, 0, Math.PI / 2, 2.4, '#2a2e35');
  sign('GALPÃO 2', 17.98, 3.25, 0, -Math.PI / 2, 2.4, '#2a2e35');

  // Numeração dos contêineres
  for (const b of def.boxes) {
    if (b.mat !== 'containerA' && b.mat !== 'containerB') continue;
    const sx = b.max.x - b.min.x;
    const sz = b.max.z - b.min.z;
    const tex = labelTexture(`NLP ${1000 + Math.floor(rng() * 8999)}`, '#f3efe6');
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const g = new THREE.PlaneGeometry(1.8, 0.45);
    disposables.push(tex, mat, g);
    const cy = b.min.y + (b.max.y - b.min.y) * 0.72;
    for (const side of [-1, 1]) {
      const m = add(new THREE.Mesh(g, mat));
      if (sz > sx) {
        m.position.set(side > 0 ? b.max.x + 0.01 : b.min.x - 0.01, cy, (b.min.z + b.max.z) / 2);
        m.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        m.position.set((b.min.x + b.max.x) / 2, cy, side > 0 ? b.max.z + 0.01 : b.min.z - 0.01);
        m.rotation.y = side > 0 ? 0 : Math.PI;
      }
    }
  }

  // Horizonte industrial (silhuetas fora da arena)
  const silMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 1 });
  disposables.push(silMat);
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2 + rng() * 0.1;
    const dist = 55 + rng() * 40;
    const w = 6 + rng() * 14;
    const h = 8 + rng() * 22;
    const g = new THREE.BoxGeometry(w, h, 6 + rng() * 10);
    disposables.push(g);
    const m = add(new THREE.Mesh(g, silMat));
    m.position.set(Math.cos(ang) * dist, h / 2 - 1, Math.sin(ang) * dist);
    m.rotation.y = rng() * Math.PI;
    if (rng() > 0.6) {
      const cg = new THREE.CylinderGeometry(0.9, 1.3, h + 18, 10);
      disposables.push(cg);
      const c = add(new THREE.Mesh(cg, silMat));
      c.position.set(m.position.x + 2, (h + 18) / 2 - 1, m.position.z);
    }
  }
}
