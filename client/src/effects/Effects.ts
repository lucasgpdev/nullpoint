/**
 * Efeitos visuais com pools pré-alocados (sem criar objetos durante o combate):
 * traçantes, faíscas de impacto, marcas de bala, impacto em jogador e clarão no mundo.
 */
import * as THREE from 'three';

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  color: THREE.Color;
  size: number;
  gravity: number;
}

const PARTICLES = 400;

export class Effects {
  readonly group = new THREE.Group();
  private tracers: Tracer[] = [];
  private decals: { mesh: THREE.Mesh; life: number }[] = [];
  private decalIndex = 0;
  private particles: Particle[] = [];
  private points: THREE.Points;
  private pGeo: THREE.BufferGeometry;
  private lights: { light: THREE.PointLight; life: number }[] = [];
  private disposables: { dispose(): void }[] = [];
  private tmp = new THREE.Vector3();

  constructor(maxDecals: number) {
    // Traçantes: cilindro fino esticado entre origem e destino
    const tracerGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 5, 1, true);
    tracerGeo.translate(0, 0.5, 0);
    tracerGeo.rotateX(Math.PI / 2);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    this.disposables.push(tracerGeo, tracerMat);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, life: 0, max: 0.07 });
      this.disposables.push(m.material as THREE.Material);
    }

    // Marcas de bala
    const decalTex = makeDecalTexture();
    const decalMat = new THREE.MeshStandardMaterial({ map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    const decalGeo = new THREE.PlaneGeometry(0.09, 0.09);
    this.disposables.push(decalTex, decalMat, decalGeo);
    for (let i = 0; i < maxDecals; i++) {
      const m = new THREE.Mesh(decalGeo, decalMat);
      m.visible = false;
      this.group.add(m);
      this.decals.push({ mesh: m, life: 0 });
    }

    // Partículas (faíscas, poeira, impacto em jogador)
    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    this.pGeo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(PARTICLES), 1));
    const pMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      vertexShader: `
        attribute float size; varying vec3 vColor;
        void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec3 vColor;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c,c); if (d > 0.25) discard;
          gl_FragColor = vec4(vColor, 1.0 - d*4.0); }`,
    });
    this.points = new THREE.Points(this.pGeo, pMat);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.disposables.push(this.pGeo, pMat);
    for (let i = 0; i < PARTICLES; i++)
      this.particles.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, color: new THREE.Color(), size: 0, gravity: 0 });

    // Luzes de clarão (quantidade fixa para não recompilar shaders)
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffa860, 0, 7, 2);
      this.group.add(l);
      this.lights.push({ light: l, life: 0 });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.tracers.find((x) => x.life <= 0) ?? this.tracers[0];
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.life = t.max;
  }

  muzzleLight(pos: THREE.Vector3): void {
    const l = this.lights.find((x) => x.life <= 0) ?? this.lights[0];
    l.light.position.copy(pos);
    l.light.intensity = 6;
    l.life = 0.05;
  }

  private emit(pos: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number, color: THREE.ColorRepresentation, size: number, life: number, gravity: number, spread = 1) {
    const c = new THREE.Color(color);
    let n = 0;
    for (const p of this.particles) {
      if (p.life > 0) continue;
      p.pos.copy(pos);
      p.vel.set(dir.x + (Math.random() - 0.5) * spread, dir.y + (Math.random() - 0.5) * spread, dir.z + (Math.random() - 0.5) * spread).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.color.copy(c);
      p.size = size;
      p.gravity = gravity;
      if (++n >= count) break;
    }
  }

  impactWorld(point: THREE.Vector3, normal: THREE.Vector3): void {
    this.emit(point, normal, 10, 4.5, 0xffc27a, 0.05, 0.25, 9, 1.4);
    this.emit(point, normal, 6, 1.0, 0x6a625a, 0.16, 0.6, -0.5, 1.2);
    const d = this.decals[this.decalIndex];
    this.decalIndex = (this.decalIndex + 1) % this.decals.length;
    d.mesh.position.copy(point).addScaledVector(normal, 0.003);
    this.tmp.copy(point).add(normal);
    d.mesh.lookAt(this.tmp);
    d.mesh.rotation.z = Math.random() * Math.PI * 2;
    d.mesh.visible = true;
    d.life = 25;
  }

  impactPlayer(point: THREE.Vector3, dir: THREE.Vector3, head: boolean): void {
    this.emit(point, dir, head ? 22 : 12, 2.4, head ? 0xff3b2f : 0xc4271c, 0.07, 0.35, 6, 1.2);
  }

  update(dt: number): void {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / t.max) * 0.7;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const d of this.decals) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) d.mesh.visible = false;
    }
    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      if (l.life <= 0) l.light.intensity = 0;
    }
    const pos = this.pGeo.attributes.position as THREE.BufferAttribute;
    const col = this.pGeo.attributes.color as THREE.BufferAttribute;
    const size = this.pGeo.attributes.size as THREE.BufferAttribute;
    this.particles.forEach((p, i) => {
      if (p.life > 0) {
        p.life -= dt;
        p.vel.y -= p.gravity * dt;
        p.pos.addScaledVector(p.vel, dt);
        const k = Math.max(0, p.life / p.max);
        pos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
        col.setXYZ(i, p.color.r * k, p.color.g * k, p.color.b * k);
        size.setX(i, p.size);
      } else {
        size.setX(i, 0);
      }
    });
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

function makeDecalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(10,10,10,1)');
  g.addColorStop(0.3, 'rgba(25,22,20,0.9)');
  g.addColorStop(0.6, 'rgba(60,55,50,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
