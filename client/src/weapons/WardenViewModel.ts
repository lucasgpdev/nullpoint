/**
 * P9 WARDEN — pistola semiautomática em primeira pessoa.
 * Modelo construído por geometria (slide, armação, cano, miras, empunhadura, carregador, gatilho)
 * com materiais PBR, mãos/braços separados e animações próprias: saque, disparo, recarga e inspeção.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ClipPlayer, Easing, type Clip } from '../animations/Clip';
import type { ViewModel, ViewModelContext } from './ViewModel';

const CH = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'slide', 'magY', 'magHide', 'lhx', 'lhy', 'lhz', 'lhr'] as const;
type Ch = (typeof CH)[number];

const E = Easing;

// ---------- Clipes ----------
const DRAW: Clip<Ch> = {
  name: 'draw',
  duration: 0.45,
  tracks: {
    py: [[0, -0.16], [0.32, 0.004, E.out], [0.45, 0]],
    rx: [[0, -0.9], [0.34, 0.05, E.out], [0.45, 0]],
    rz: [[0, 0.35], [0.36, 0, E.out]],
    slide: [[0, 0], [0.3, 0], [0.36, -0.032, E.out], [0.43, 0, E.in]],
  },
  events: [[0.05, 'draw'], [0.36, 'slide']],
};

const FIRE: Clip<Ch> = {
  name: 'fire',
  duration: 0.16,
  tracks: {
    pz: [[0, 0], [0.025, 0.034, E.out], [0.16, 0]],
    rx: [[0, 0], [0.025, 0.11, E.out], [0.16, 0]],
    py: [[0, 0], [0.03, 0.006, E.out], [0.16, 0]],
    slide: [[0, 0], [0.018, -0.036, E.out], [0.085, 0, E.in]],
  },
};

const DRY: Clip<Ch> = {
  name: 'dry',
  duration: 0.12,
  tracks: { rx: [[0, 0], [0.04, 0.02], [0.12, 0]] },
};

const RELOAD: Clip<Ch> = {
  name: 'reload',
  duration: 2.0,
  tracks: {
    rz: [[0, 0], [0.25, 0.42], [1.35, 0.42], [1.6, 0.12], [1.85, 0]],
    rx: [[0, 0], [0.25, 0.18], [1.1, 0.18], [1.2, 0.26, E.out], [1.35, 0.16], [1.85, 0]],
    py: [[0, 0], [0.25, 0.025], [1.35, 0.025], [1.85, 0]],
    px: [[0, 0], [0.25, -0.02], [1.35, -0.02], [1.85, 0]],
    magY: [[0, 0], [0.3, 0], [0.42, -0.07, E.in], [0.55, -0.3, E.in], [0.75, -0.3], [0.85, -0.12, E.out], [1.1, -0.035], [1.18, 0, E.out]],
    magHide: [[0, 0], [0.54, 0], [0.55, 1], [0.74, 1], [0.75, 0]],
    lhy: [[0, 0], [0.3, -0.02], [0.6, -0.24], [0.78, -0.24], [1.08, -0.06, E.out], [1.2, -0.02], [1.45, 0.025], [1.55, -0.005, E.out], [1.85, 0]],
    lhx: [[0, 0], [0.3, -0.02], [0.6, -0.06], [0.8, -0.04], [1.1, -0.01], [1.4, 0.0], [1.85, 0]],
    lhz: [[0, 0], [0.6, 0.06], [0.8, 0.04], [1.1, 0.02], [1.4, -0.06], [1.5, -0.02, E.out], [1.85, 0]],
    lhr: [[0, 0], [0.6, 0.5], [1.1, 0.2], [1.4, 0], [1.85, 0]],
    slide: [[0, 0], [1.4, 0], [1.46, -0.036, E.out], [1.53, 0, E.in]],
  },
  events: [[0.38, 'magOut'], [1.14, 'magIn'], [1.48, 'slide']],
};

const INSPECT: Clip<Ch> = {
  name: 'inspect',
  duration: 3.2,
  tracks: {
    px: [[0, 0], [0.5, -0.07], [1.6, -0.08], [2.3, -0.05], [3.2, 0]],
    py: [[0, 0], [0.5, 0.03], [1.6, 0.035], [2.3, 0.05], [3.2, 0]],
    pz: [[0, 0], [0.5, 0.05], [2.3, 0.05], [3.2, 0]],
    ry: [[0, 0], [0.5, 0.95], [1.5, 1.05], [2.0, -0.6], [2.6, -0.7], [3.2, 0]],
    rz: [[0, 0], [0.5, -0.35], [1.5, -0.4], [2.0, 0.9], [2.6, 0.95], [3.2, 0]],
    rx: [[0, 0], [0.5, 0.12], [1.5, 0.1], [2.0, 0.25], [2.6, 0.2], [3.2, 0]],
    slide: [[0, 0], [2.65, 0], [2.8, -0.02, E.out], [2.95, 0]],
  },
  events: [[2.8, 'slideTap']],
};

// ---------- Materiais ----------
function makeMaterials() {
  return {
    slide: new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.85, roughness: 0.32 }),
    slideDark: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.7, roughness: 0.45 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.05, roughness: 0.72 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0, roughness: 0.95 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xff5a1f, metalness: 0.2, roughness: 0.5 }),
    barrel: new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.95, roughness: 0.22 }),
    sight: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff7a3a, emissiveIntensity: 1.6 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x2d2f2c, metalness: 0, roughness: 0.85 }),
    knuckle: new THREE.MeshStandardMaterial({ color: 0x3b3f3a, metalness: 0.1, roughness: 0.6 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x3f463d, metalness: 0, roughness: 0.92 }),
    cuff: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, metalness: 0.3, roughness: 0.5 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 }),
  };
}

const rbox = (w: number, h: number, d: number, r = 0.003) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));

export class WardenViewModel implements ViewModel {
  readonly object = new THREE.Group();
  onAnimEvent?: (name: string) => void;

  private readonly root = new THREE.Group();
  private readonly gun = new THREE.Group();
  private readonly slide = new THREE.Group();
  private readonly mag = new THREE.Group();
  private readonly leftHand = new THREE.Group();
  private readonly muzzle = new THREE.Object3D();
  private readonly ejectPort = new THREE.Object3D();
  private readonly flash: THREE.Mesh;
  private readonly flashLight: THREE.PointLight;
  private flashTime = 0;
  private readonly casings: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }[] = [];
  private readonly mats = makeMaterials();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly anim = new ClipPlayer<Ch>(CH);

  // Estado procedural
  private bobPhase = 0;
  private bobAmount = 0;
  private sprint = 0;
  private swayX = 0;
  private swayY = 0;
  private air = 0;
  private time = 0;
  private recoil = { z: 0, vz: 0, x: 0, vx: 0 };
  private static readonly BASE = new THREE.Vector3(0.1, -0.106, -0.335);

  constructor() {
    this.buildGun();
    this.buildArms();
    this.root.add(this.gun);
    this.object.add(this.root);
    this.root.position.copy(WardenViewModel.BASE);

    // Clarão do disparo
    const flashGeo = this.g(new THREE.PlaneGeometry(0.11, 0.11));
    const flashTex = makeFlashTexture();
    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: 0xffc58a,
    });
    this.flash = new THREE.Mesh(flashGeo, flashMat);
    this.flash.visible = false;
    this.muzzle.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffa860, 0, 1.2, 2);
    this.muzzle.add(this.flashLight);

    // Cápsulas ejetadas
    const casingGeo = this.g(new THREE.CylinderGeometry(0.0045, 0.0045, 0.019, 8));
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(casingGeo, this.mats.brass);
      m.visible = false;
      this.object.add(m);
      this.casings.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }

    this.anim.onEvent = (n) => this.onAnimEvent?.(n);
    this.object.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  private g<T extends THREE.BufferGeometry>(geo: T): T {
    this.geos.push(geo);
    return geo;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
    const m = new THREE.Mesh(this.g(geo), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  private buildGun() {
    const M = this.mats;
    const gun = this.gun;

    // Armação de polímero e trilho
    this.mesh(rbox(0.027, 0.024, 0.165, 0.004), M.frame, 0, 0.004, -0.078, gun);
    this.mesh(rbox(0.022, 0.008, 0.06, 0.002), M.frame, 0, -0.011, -0.12, gun);
    for (let i = 0; i < 3; i++) this.mesh(new THREE.BoxGeometry(0.024, 0.003, 0.006), M.slideDark, 0, -0.016, -0.1 - i * 0.015, gun);

    // Slide (animado)
    this.slide.position.set(0, 0.03, -0.085);
    gun.add(this.slide);
    this.mesh(rbox(0.03, 0.032, 0.19, 0.005), M.slide, 0, 0, 0, this.slide);
    this.mesh(rbox(0.026, 0.006, 0.17, 0.002), M.slideDark, 0, 0.0165, 0.004, this.slide); // faixa superior
    for (let i = 0; i < 7; i++) {
      for (const sx of [-1, 1]) {
        this.mesh(new THREE.BoxGeometry(0.0015, 0.022, 0.0028), M.slideDark, sx * 0.0152, -0.002, 0.058 + i * 0.0055, this.slide);
        this.mesh(new THREE.BoxGeometry(0.0015, 0.022, 0.0028), M.slideDark, sx * 0.0152, -0.002, -0.078 + i * 0.0055, this.slide);
      }
    }
    this.mesh(new THREE.BoxGeometry(0.004, 0.012, 0.032), M.slideDark, 0.0142, 0.005, -0.01, this.slide); // janela de ejeção
    this.mesh(new THREE.BoxGeometry(0.0035, 0.007, 0.006), M.slideDark, 0, 0.0195, -0.088, this.slide); // massa de mira
    this.mesh(new THREE.BoxGeometry(0.0016, 0.0016, 0.0012), M.sight, 0, 0.022, -0.0915, this.slide); // ponto luminoso
    const rear = new THREE.Group();
    rear.position.set(0, 0.0195, 0.085);
    this.slide.add(rear);
    this.mesh(new THREE.BoxGeometry(0.008, 0.007, 0.008), M.slideDark, -0.0075, 0, 0, rear);
    this.mesh(new THREE.BoxGeometry(0.008, 0.007, 0.008), M.slideDark, 0.0075, 0, 0, rear);
    this.mesh(new THREE.BoxGeometry(0.0015, 0.0015, 0.001), M.sight, -0.0055, 0.002, -0.0042, rear);
    this.mesh(new THREE.BoxGeometry(0.0015, 0.0015, 0.001), M.sight, 0.0055, 0.002, -0.0042, rear);
    this.mesh(rbox(0.031, 0.004, 0.012, 0.0015), M.accent, 0, -0.0145, -0.083, this.slide); // detalhe frontal
    this.ejectPort.position.set(0.016, 0.006, -0.01);
    this.slide.add(this.ejectPort);

    // Cano
    const barrel = this.mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.014, 14), M.barrel, 0, 0.032, -0.183, gun);
    barrel.rotation.x = Math.PI / 2;
    const bore = this.mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.0145, 12), M.slideDark, 0, 0.032, -0.183, gun);
    bore.rotation.x = Math.PI / 2;
    this.muzzle.position.set(0, 0.032, -0.195);
    this.muzzle.rotation.y = Math.PI; // plano do clarão voltado para a câmera
    gun.add(this.muzzle);

    // Guarda-mato e gatilho
    this.mesh(rbox(0.012, 0.006, 0.05, 0.002), M.frame, 0, -0.033, -0.04, gun);
    this.mesh(rbox(0.012, 0.03, 0.006, 0.002), M.frame, 0, -0.019, -0.064, gun);
    const trig = this.mesh(rbox(0.006, 0.02, 0.006, 0.002), M.slideDark, 0, -0.016, -0.038, gun);
    trig.rotation.x = 0.25;

    // Empunhadura inclinada com textura e inserto de cor
    const grip = new THREE.Group();
    grip.position.set(0, -0.012, 0.008);
    grip.rotation.x = 0.26;
    gun.add(grip);
    this.mesh(rbox(0.031, 0.105, 0.05, 0.007), M.grip, 0, -0.048, 0, grip);
    this.mesh(rbox(0.0326, 0.055, 0.03, 0.004), M.frame, 0, -0.045, 0.002, grip);
    this.mesh(rbox(0.006, 0.07, 0.006, 0.002), M.accent, 0, -0.045, 0.026, grip);
    this.mesh(rbox(0.033, 0.012, 0.03, 0.004), M.frame, 0, 0.004, 0.022, grip); // beavertail

    // Carregador (animado ao longo do eixo da empunhadura)
    grip.add(this.mag);
    this.mesh(rbox(0.022, 0.1, 0.038, 0.003), M.slide, 0, -0.045, 0, this.mag);
    this.mesh(rbox(0.034, 0.009, 0.054, 0.003), M.accent, 0, -0.1, 0.001, this.mag);
    this.mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.008, 8), M.brass, 0, 0.007, -0.006, this.mag).rotation.x = Math.PI / 2;
  }

  private buildArms() {
    const M = this.mats;
    // Mão direita envolvendo a empunhadura
    const right = new THREE.Group();
    right.position.set(0, -0.04, 0.012);
    right.rotation.x = 0.26;
    this.gun.add(right);
    this.mesh(rbox(0.05, 0.07, 0.06, 0.016), M.glove, 0.006, -0.012, 0.022, right); // palma
    for (let i = 0; i < 3; i++) {
      const f = this.mesh(rbox(0.044, 0.017, 0.022, 0.008), M.glove, -0.001, -0.004 - i * 0.02, -0.03, right);
      f.rotation.x = -0.05;
    }
    this.mesh(rbox(0.012, 0.016, 0.01, 0.004), M.knuckle, 0.02, -0.004, -0.03, right);
    const index = this.mesh(rbox(0.014, 0.014, 0.05, 0.006), M.glove, 0.017, 0.03, -0.045, right); // dedo indicador ao longo da armação
    index.rotation.x = -0.26;
    const thumb = this.mesh(rbox(0.016, 0.016, 0.055, 0.007), M.glove, -0.022, 0.025, -0.02, right);
    thumb.rotation.set(-0.3, 0.12, 0);
    const rWrist = this.mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.03, 14), M.cuff, 0.008, -0.03, 0.065, right);
    rWrist.rotation.x = Math.PI / 2 - 0.5;
    const rArm = this.mesh(new THREE.CylinderGeometry(0.034, 0.046, 0.42, 16), M.sleeve, 0.03, -0.11, 0.24, right);
    rArm.rotation.x = Math.PI / 2 - 0.55;
    rArm.rotation.z = -0.12;

    // Mão esquerda de apoio (animada na recarga)
    this.leftHand.position.set(-0.026, -0.05, 0.0);
    this.gun.add(this.leftHand);
    const lh = new THREE.Group();
    lh.rotation.set(0.2, 0.3, 0.35);
    this.leftHand.add(lh);
    this.mesh(rbox(0.045, 0.066, 0.06, 0.016), M.glove, -0.006, 0, 0.012, lh);
    for (let i = 0; i < 3; i++) this.mesh(rbox(0.04, 0.016, 0.02, 0.007), M.glove, 0.016, 0.005 - i * 0.019, -0.03, lh);
    const lThumb = this.mesh(rbox(0.015, 0.015, 0.05, 0.007), M.glove, 0.002, 0.034, -0.018, lh);
    lThumb.rotation.x = -0.2;
    const lWrist = this.mesh(new THREE.CylinderGeometry(0.029, 0.031, 0.03, 14), M.cuff, -0.012, -0.012, 0.05, lh);
    lWrist.rotation.x = Math.PI / 2 - 0.3;
    const lArm = this.mesh(new THREE.CylinderGeometry(0.033, 0.045, 0.42, 16), M.sleeve, -0.06, -0.08, 0.24, lh);
    lArm.rotation.x = Math.PI / 2 - 0.42;
    lArm.rotation.z = 0.3;
  }

  // ---------- API ----------
  draw(duration: number): void {
    this.anim.play(DRAW, { duration, blend: 0 });
  }
  fire(): void {
    this.anim.play(FIRE, { blend: 0.02 });
    this.recoil.vz += 1.2;
    this.recoil.vx += 9;
    this.flashTime = 0.045;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.5;
    this.flash.scale.set(s, s, s);
    this.ejectCasing();
  }
  dryFire(): void {
    this.anim.play(DRY, { blend: 0.02 });
  }
  reload(duration: number): void {
    this.anim.play(RELOAD, { duration, blend: 0.06 });
  }
  inspect(): void {
    if (this.anim.current) return;
    this.anim.play(INSPECT, { blend: 0.15 });
  }
  get isInspecting(): boolean {
    return this.anim.current === 'inspect';
  }
  reset(): void {
    this.anim.stop(0);
    this.flash.visible = false;
    this.flashLight.intensity = 0;
  }

  muzzlePosition(out: THREE.Vector3): THREE.Vector3 {
    this.object.updateMatrixWorld(true);
    return this.muzzle.getWorldPosition(out);
  }

  private ejectCasing() {
    const c = this.casings.find((x) => x.life <= 0) ?? this.casings[0];
    this.object.updateMatrixWorld(true);
    this.ejectPort.getWorldPosition(c.mesh.position);
    c.vel.set(0.9 + Math.random() * 0.4, 0.9 + Math.random() * 0.4, 0.25 + Math.random() * 0.2);
    c.spin.set(Math.random() * 30, Math.random() * 30, Math.random() * 30);
    c.life = 0.7;
    c.mesh.visible = true;
  }

  update(dt: number, ctx: ViewModelContext): void {
    this.time += dt;
    this.anim.update(dt);
    const A = (c: Ch) => this.anim.value(c);

    // Corrida / balanço / ar
    const sprintTarget = ctx.sprinting && ctx.speed > 1 && !ctx.reloading && this.anim.current !== 'fire' ? 1 : 0;
    this.sprint += (sprintTarget - this.sprint) * Math.min(1, dt * 9);
    const moveTarget = ctx.onGround ? Math.min(1, ctx.speed / 4.4) : 0;
    this.bobAmount += (moveTarget - this.bobAmount) * Math.min(1, dt * 8);
    this.bobPhase += dt * (ctx.speed > 0.2 ? 6 + ctx.speed * 1.1 : 0);
    const airTarget = ctx.onGround ? 0 : Math.max(-1, Math.min(1, ctx.velY / 6));
    this.air += (airTarget - this.air) * Math.min(1, dt * 10);

    // Balanço pelo movimento do mouse (inércia)
    const tx = Math.max(-1, Math.min(1, -ctx.lookDX * 0.02));
    const ty = Math.max(-1, Math.min(1, ctx.lookDY * 0.02));
    this.swayX += (tx - this.swayX) * Math.min(1, dt * 12);
    this.swayY += (ty - this.swayY) * Math.min(1, dt * 12);

    // Mola de recuo integrada em sub-passos fixos (estável mesmo com quadros longos)
    const r = this.recoil;
    for (let left = dt; left > 0; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      r.vz += (-r.z * 260 - r.vz * 26) * h;
      r.z += r.vz * h;
      r.vx += (-r.x * 300 - r.vx * 24) * h;
      r.x += r.vx * h;
    }

    const bobScale = 1 + this.sprint * 1.6;
    const bx = Math.sin(this.bobPhase) * 0.007 * this.bobAmount * bobScale;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.009 * this.bobAmount * bobScale;
    const breath = Math.sin(this.time * 1.7) * 0.0012;

    const s = this.sprint;
    const base = WardenViewModel.BASE;
    this.root.position.set(
      base.x + A('px') + bx + this.swayX * 0.008 - s * 0.03,
      base.y + A('py') + by + breath - this.air * 0.012 - s * 0.045 + this.swayY * 0.006,
      base.z + A('pz') + r.z * 0.02 + s * 0.02,
    );
    this.root.rotation.set(
      A('rx') + r.x * 0.02 - s * 0.55 + this.swayY * 0.05 + this.air * 0.04,
      A('ry') + this.swayX * 0.08 + s * 0.55,
      A('rz') + this.swayX * 0.06 + bx * 2 + s * 0.25,
    );
    this.slide.position.z = -0.085 - A('slide');
    this.mag.position.y = A('magY');
    this.mag.visible = A('magHide') < 0.5;
    this.leftHand.position.set(-0.026 + A('lhx'), -0.05 + A('lhy'), A('lhz'));
    this.leftHand.rotation.x = A('lhr');

    // Clarão
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flashLight.intensity = 2.5;
      if (this.flashTime <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }

    // Cápsulas
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.vel.y -= 6 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.life <= 0) c.mesh.visible = false;
    }
  }

  dispose(): void {
    this.geos.forEach((g) => g.dispose());
    Object.values(this.mats).forEach((m) => m.dispose());
  }
}

function makeFlashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.25, 'rgba(255,200,120,0.9)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.translate(64, 64);
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(0, -62);
    ctx.lineTo(6, 0);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
