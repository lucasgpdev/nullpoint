/**
 * Personagem em terceira pessoa (jogadores remotos).
 * Hierarquia articulada (quadril, tronco, cabeça, braços, coxas, canelas) animada proceduralmente:
 * caminhada/corrida em qualquer direção, inclinação da mira, pulo, recuo, recarga e queda ao morrer.
 * Pode ser substituído por um GLB com esqueleto mantendo a mesma API.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { WALK_SPEED } from '@nullpoint/shared';

const shared = {
  geos: new Map<string, THREE.BufferGeometry>(),
  geo(key: string, make: () => THREE.BufferGeometry) {
    let g = this.geos.get(key);
    if (!g) this.geos.set(key, (g = make()));
    return g;
  },
};

const rb = (w: number, h: number, d: number, r: number) =>
  shared.geo(`rb:${w}:${h}:${d}:${r}`, () => new RoundedBoxGeometry(w, h, d, 2, r));

export class CharacterModel {
  readonly object = new THREE.Group();
  private readonly body = new THREE.Group(); // gira com yaw
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly thighL = new THREE.Group();
  private readonly thighR = new THREE.Group();
  private readonly shinL = new THREE.Group();
  private readonly shinR = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  private readonly mats: THREE.Material[] = [];
  private phase = 0;
  private stride = 0;
  private recoil = 0;
  private reloadT = 0;
  private death = 0;
  private dead = false;
  private flash: THREE.Mesh;
  private flashT = 0;
  private lastPos = new THREE.Vector3();
  private moveDir = new THREE.Vector2();

  constructor(color: number) {
    const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, emissive: color, emissiveIntensity: 0.12 });
    const suit = new THREE.MeshStandardMaterial({ color: 0x3a3f38, roughness: 0.9 });
    const armor = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.6, metalness: 0.3 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x9c7a62, roughness: 0.8 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.15, metalness: 0.9, emissive: color, emissiveIntensity: 0.25 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.4, metalness: 0.8 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.85 });
    this.mats.push(accent, suit, armor, skin, visor, gunMat, boots);

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    this.object.add(this.body);
    this.hips.position.y = 0.92;
    this.body.add(this.hips);
    add(this.hips, rb(0.36, 0.16, 0.22, 0.04), suit, 0, 0, 0);
    add(this.hips, rb(0.38, 0.05, 0.24, 0.02), armor, 0, 0.06, 0); // cinto

    // Pernas
    for (const [thigh, shin, sx] of [[this.thighL, this.shinL, -1], [this.thighR, this.shinR, 1]] as const) {
      thigh.position.set(sx * 0.1, -0.06, 0);
      this.hips.add(thigh);
      add(thigh, rb(0.15, 0.44, 0.17, 0.05), suit, 0, -0.21, 0);
      add(thigh, rb(0.12, 0.12, 0.05, 0.02), armor, 0, -0.38, -0.085); // joelheira
      shin.position.set(0, -0.42, 0);
      thigh.add(shin);
      add(shin, rb(0.13, 0.4, 0.14, 0.04), suit, 0, -0.2, 0);
      add(shin, rb(0.14, 0.09, 0.26, 0.03), boots, 0, -0.43, -0.04);
    }

    // Tronco e colete
    this.torso.position.y = 0.08;
    this.hips.add(this.torso);
    add(this.torso, rb(0.42, 0.5, 0.24, 0.06), suit, 0, 0.26, 0);
    add(this.torso, rb(0.44, 0.4, 0.29, 0.05), armor, 0, 0.3, 0);
    add(this.torso, rb(0.3, 0.06, 0.02, 0.01), accent, 0, 0.36, -0.15); // faixa de identificação
    add(this.torso, rb(0.12, 0.12, 0.06, 0.02), armor, -0.1, 0.18, -0.16);
    add(this.torso, rb(0.12, 0.12, 0.06, 0.02), armor, 0.1, 0.18, -0.16);
    add(this.torso, rb(0.28, 0.32, 0.12, 0.03), armor, 0, 0.32, 0.18); // mochila

    // Cabeça com capacete
    this.head.position.y = 0.6;
    this.torso.add(this.head);
    add(this.head, rb(0.08, 0.08, 0.08, 0.02), skin, 0, -0.02, 0); // pescoço
    add(this.head, rb(0.2, 0.22, 0.22, 0.07), skin, 0, 0.1, 0);
    add(this.head, rb(0.25, 0.14, 0.27, 0.07), armor, 0, 0.19, 0.01); // capacete
    add(this.head, rb(0.21, 0.06, 0.04, 0.02), visor, 0, 0.12, -0.11);
    add(this.head, rb(0.05, 0.03, 0.12, 0.01), accent, 0, 0.27, 0.02);

    // Braços apontando a pistola
    const gun = new THREE.Group();
    for (const [arm, sx] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(sx * 0.25, 0.46, 0);
      this.torso.add(arm);
      add(arm, rb(0.13, 0.13, 0.13, 0.04), armor, 0, 0, 0); // ombreira
      const upper = add(arm, rb(0.1, 0.1, 0.3, 0.03), suit, -sx * 0.04, -0.06, -0.14);
      upper.rotation.y = sx * 0.25;
      const fore = add(arm, rb(0.09, 0.09, 0.28, 0.03), suit, -sx * 0.11, -0.08, -0.38);
      fore.rotation.y = sx * 0.4;
      add(arm, rb(0.08, 0.09, 0.09, 0.03), boots, -sx * 0.2, -0.08, -0.52); // luva
    }
    gun.position.set(-0.04, 0.38, -0.56);
    this.torso.add(gun);
    add(gun, rb(0.035, 0.04, 0.2, 0.01), gunMat, 0, 0.03, -0.04);
    add(gun, rb(0.032, 0.1, 0.05, 0.01), gunMat, 0, -0.03, 0.03).rotation.x = 0.25;
    this.muzzle.position.set(0, 0.035, -0.15);
    gun.add(this.muzzle);

    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mats.push(flashMat);
    this.flash = new THREE.Mesh(shared.geo('flash', () => new THREE.SphereGeometry(0.07, 8, 6)), flashMat);
    this.flash.visible = false;
    this.muzzle.add(this.flash);
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.object.position.set(x, y, z);
    this.body.rotation.y = yaw;
    // Mira: o tronco acompanha parte do pitch e a cabeça o restante.
    this.torso.rotation.x = pitch * 0.55;
    this.head.rotation.x = pitch * 0.4;
  }

  fire(): void {
    this.recoil = 1;
    this.flashT = 0.05;
    this.flash.visible = true;
  }

  reload(): void {
    this.reloadT = 1;
  }

  setDead(dead: boolean): void {
    if (dead === this.dead) return;
    this.dead = dead;
    if (!dead) {
      this.death = 0;
      this.body.rotation.x = 0;
      this.body.position.y = 0;
    }
  }

  update(dt: number, speed: number, onGround: boolean): void {
    // Direção do movimento relativa ao corpo (para pernas em movimento lateral/para trás)
    const p = this.object.position;
    const dx = p.x - this.lastPos.x;
    const dz = p.z - this.lastPos.z;
    this.lastPos.copy(p);
    const yaw = this.body.rotation.y;
    const fwd = -(dx * -Math.sin(yaw) + dz * -Math.cos(yaw));
    const side = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    if (Math.hypot(dx, dz) > 1e-4) this.moveDir.set(side, -fwd).normalize();

    const run = Math.min(1.6, speed / WALK_SPEED);
    this.stride += ((onGround ? run : 0.3) - this.stride) * Math.min(1, dt * 8);
    this.phase += dt * (5 + speed * 1.4) * (speed > 0.3 ? 1 : 0);
    const backwards = this.moveDir.y < -0.3 ? -1 : 1;
    const swing = Math.sin(this.phase) * 0.6 * this.stride * backwards;
    const lateral = Math.abs(this.moveDir.x) > 0.7 ? 0.5 : 1;

    this.thighL.rotation.x = swing * lateral;
    this.thighR.rotation.x = -swing * lateral;
    this.thighL.rotation.z = -this.moveDir.x * 0.15 * this.stride;
    this.thighR.rotation.z = -this.moveDir.x * 0.15 * this.stride;
    this.shinL.rotation.x = Math.max(0, -Math.sin(this.phase + 1.2)) * 0.9 * this.stride;
    this.shinR.rotation.x = Math.max(0, Math.sin(this.phase + 1.2)) * 0.9 * this.stride;
    if (!onGround) {
      this.thighL.rotation.x = -0.5;
      this.thighR.rotation.x = 0.2;
      this.shinL.rotation.x = 0.9;
      this.shinR.rotation.x = 0.5;
    }
    this.hips.position.y = 0.92 + Math.abs(Math.cos(this.phase)) * 0.03 * this.stride;

    // Recuo e recarga nos braços
    this.recoil = Math.max(0, this.recoil - dt * 8);
    this.reloadT = Math.max(0, this.reloadT - dt / 2);
    const reloadDip = this.reloadT > 0 ? Math.sin(this.reloadT * Math.PI) * 0.6 : 0;
    this.armL.rotation.x = this.recoil * 0.25 - reloadDip;
    this.armR.rotation.x = this.recoil * 0.25 - reloadDip * 0.4;

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }

    // Animação de eliminação: tomba para trás e afunda
    if (this.dead) {
      this.death = Math.min(1, this.death + dt * 2.2);
      const e = 1 - (1 - this.death) ** 3;
      this.body.rotation.x = e * 1.45;
      this.body.position.y = -e * 0.12;
      this.armL.rotation.x = -e * 1.2;
      this.armR.rotation.x = -e * 0.8;
    }
  }

  dispose(): void {
    this.mats.forEach((m) => m.dispose());
  }
}
