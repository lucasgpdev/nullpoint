import * as THREE from 'three';
import { NetFlags } from '@nullpoint/shared';
import { Interpolator, type InterpState } from '../multiplayer/Interpolator';
import { CharacterModel } from './CharacterModel';

/** Jogador remoto: buffer de interpolação + modelo + etiqueta de nome. */
export class RemotePlayer {
  readonly interp = new Interpolator();
  readonly model: CharacterModel;
  readonly label: THREE.Sprite;
  state: InterpState | null = null;
  alive = false;
  private stepDist = 0;
  private lastX = 0;
  private lastZ = 0;
  onStep?: (pos: THREE.Vector3, loud: boolean) => void;

  constructor(
    readonly id: number,
    public name: string,
    readonly color: number,
    scene: THREE.Scene,
  ) {
    this.model = new CharacterModel(color);
    scene.add(this.model.object);
    this.label = makeLabel(name, color);
    this.label.position.y = 2.15;
    this.model.object.add(this.label);
    this.model.object.visible = false;
  }

  update(renderTime: number, dt: number): void {
    const s = this.interp.sample(renderTime);
    this.state = s;
    if (!s) {
      this.model.object.visible = false;
      return;
    }
    const alive = (s.f & NetFlags.Alive) !== 0;
    if (alive && !this.alive) {
      this.interp.reset();
      this.model.setDead(false);
    }
    if (!alive && this.alive) this.model.setDead(true);
    this.alive = alive;
    this.model.object.visible = true;
    this.label.visible = alive;
    this.model.setPose(s.x, s.y, s.z, s.yaw, s.pitch);
    const onGround = (s.f & NetFlags.Ground) !== 0;
    this.model.update(dt, alive ? s.spd : 0, onGround || !alive);
    (this.label.material as THREE.SpriteMaterial).opacity = s.f & NetFlags.Protected ? 0.5 : 1;

    // Passos: um a cada ~2,1 m percorridos no chão
    if (alive && onGround) {
      this.stepDist += Math.hypot(s.x - this.lastX, s.z - this.lastZ);
      if (this.stepDist > 2.1) {
        this.stepDist = 0;
        this.onStep?.(new THREE.Vector3(s.x, s.y, s.z), s.spd > 5);
      }
    }
    this.lastX = s.x;
    this.lastZ = s.z;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.model.object);
    this.model.dispose();
    (this.label.material as THREE.SpriteMaterial).map?.dispose();
    this.label.material.dispose();
  }
}

function makeLabel(name: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = '600 34px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.min(250, ctx.measureText(name).width + 28);
  ctx.fillStyle = 'rgba(10,12,15,0.62)';
  ctx.fillRect(128 - w / 2, 10, w, 44);
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillRect(128 - w / 2, 10, 4, 44);
  ctx.fillStyle = '#f1ede4';
  ctx.fillText(name, 128 + 2, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.1, 0.275, 1);
  return s;
}
