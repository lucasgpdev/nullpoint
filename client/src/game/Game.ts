/**
 * Runtime da partida no cliente: render, entrada, previsão/reconciliação, interpolação dos remotos,
 * efeitos, áudio e HUD. O servidor continua sendo a autoridade sobre dano, abates e posições.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  currentSpread,
  EYE_HEIGHT,
  getCollisionWorld,
  hitboxesAt,
  INPUT_SEND_HZ,
  INTERP_DELAY_MS,
  MAPS,
  MAX_CMDS_PER_BATCH,
  rayAABB,
  shotDirection,
  SIM_DT,
  WALK_SPEED,
  WEAPONS,
  Buttons,
  type CollisionWorld,
  type GameEvent,
  type InputCmd,
  type MatchStart,
  type PlayerInfo,
  type Snapshot,
} from '@nullpoint/shared';
import { audio } from '../audio/AudioEngine';
import { QUALITY_PRESETS, settings, type QualityPreset } from '../config/settings';
import { Effects } from '../effects/Effects';
import { buildMap, type BuiltMap } from '../maps/MapBuilder';
import type { NetClient } from '../multiplayer/NetClient';
import { Predictor } from '../player/Predictor';
import { RemotePlayer } from '../player/RemotePlayer';
import { Hud } from '../ui/Hud';
import type { ViewModel } from '../weapons/ViewModel';
import { WardenViewModel } from '../weapons/WardenViewModel';
import { Input } from './Input';

const V = (a: { x: number; y: number; z: number } | [number, number, number]) =>
  Array.isArray(a) ? new THREE.Vector3(a[0], a[1], a[2]) : new THREE.Vector3(a.x, a.y, a.z);

export interface GameCallbacks {
  onLockChange(locked: boolean): void;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly input: Input;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly vmScene = new THREE.Scene();
  private readonly vmCamera = new THREE.PerspectiveCamera(54, 1, 0.01, 10);
  private readonly world: CollisionWorld;
  private readonly map: BuiltMap;
  private readonly predictor: Predictor;
  private readonly vm: ViewModel;
  private readonly effects: Effects;
  private readonly hud: Hud;
  private readonly remotes = new Map<number, RemotePlayer>();
  private readonly lastSeen = new Map<number, number>();
  private readonly quality: QualityPreset;
  private envTex: THREE.Texture | null = null;

  private raf = 0;
  private last = performance.now();
  private accum = 0;
  private seq = 0;
  private sendBuf: InputCmd[] = [];
  private lastSend = 0;

  private alive = false;
  private hp = 100;
  private respawnAt = 0;
  private killerId: number | null = null;
  private deathPos = new THREE.Vector3();
  private protectedUntil = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private landDip = 0;
  private wasGround = true;
  private stepDist = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private disposed = false;
  private hpById = new Map<number, number>();

  constructor(
    private readonly container: HTMLElement,
    private readonly net: NetClient,
    private readonly match: MatchStart,
    private readonly cb: GameCallbacks,
  ) {
    this.quality = QUALITY_PRESETS[settings.quality];
    const def = MAPS[match.map];
    this.world = getCollisionWorld(match.map);

    // ---- Renderer ----
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    this.renderer.domElement.className = 'game-canvas';
    container.prepend(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(this.verticalFov(), 1, 0.05, 600);
    this.scene.fog = new THREE.Fog(def.sky.fog, def.sky.fogNear, def.sky.fogFar);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.35;
    this.map = buildMap(def, this.quality);
    this.scene.add(this.map.group);

    // ---- Viewmodel em cena própria (não atravessa paredes) ----
    this.vmScene.environment = this.envTex;
    this.vmScene.environmentIntensity = 0.5;
    this.vmScene.add(new THREE.HemisphereLight(0xdfe8f0, 0x4a3c30, 1.4));
    const key = new THREE.DirectionalLight(0xffe6c8, 2.2);
    key.position.set(1, 2, 1);
    this.vmScene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd0ff, 0.8);
    rim.position.set(-2, 0.5, -1);
    this.vmScene.add(rim);
    this.vm = new WardenViewModel();
    this.vmScene.add(this.vm.object);
    this.vm.onAnimEvent = (n) => {
      if (n === 'magOut' || n === 'magIn' || n === 'slide' || n === 'draw') audio.play2D(n, 0.55);
      if (n === 'slideTap') audio.play2D('slide', 0.25);
    };

    this.effects = new Effects(this.quality.maxDecals);
    this.scene.add(this.effects.group);

    this.predictor = new Predictor(this.world);
    this.hud = new Hud(container);
    this.input = new Input(this.renderer.domElement);
    this.input.onLockChange = (l) => this.cb.onLockChange(l);

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.raf = requestAnimationFrame(this.frame);
  }

  private verticalFov(): number {
    // Configuração em FOV horizontal (16:9), convertida para vertical.
    const h = (settings.fov * Math.PI) / 180;
    return (2 * Math.atan(Math.tan(h / 2) / (16 / 9)) * 180) / Math.PI;
  }

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = this.verticalFov();
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  };

  applySettings(): void {
    this.onResize();
  }

  private playerInfo(id: number): PlayerInfo | undefined {
    return this.net.room?.players.find((p) => p.id === id);
  }

  private remote(id: number): RemotePlayer | null {
    let r = this.remotes.get(id);
    if (!r) {
      const info = this.playerInfo(id);
      if (!info) return null;
      r = new RemotePlayer(id, info.name, info.color, this.scene);
      r.onStep = (pos, loud) => audio.play3D('step', pos, loud ? 0.8 : 0.45, this.occluded(pos));
      this.remotes.set(id, r);
    }
    return r;
  }

  // ---------- Rede ----------
  onSnapshot(s: Snapshot): void {
    const now = performance.now();
    for (const p of s.players) {
      this.hpById.set(p.id, p.hp);
      if (p.id === this.net.playerId) continue;
      const r = this.remote(p.id);
      if (!r) continue;
      r.interp.push(s.t, p);
      this.lastSeen.set(p.id, now);
    }
    // Remove quem saiu
    for (const [id, r] of this.remotes) {
      if (now - (this.lastSeen.get(id) ?? 0) > 1500) {
        r.dispose(this.scene);
        this.remotes.delete(id);
      }
    }

    const me = s.me;
    this.hp = me.hp;
    this.respawnAt = me.respawnAt;
    if (me.alive && !this.alive) this.spawnLocal(s);
    else if (!me.alive && this.alive) this.dieLocal(null);
    else if (me.alive) this.predictor.reconcile(me);
    const myFlags = s.players.find((p) => p.id === this.net.playerId)?.f ?? 0;
    this.protectedUntil = myFlags & 8 ? performance.now() + 100 : 0;
  }

  private spawnLocal(s: Snapshot): void {
    this.alive = true;
    this.killerId = null;
    this.predictor.resetFrom(s.me);
    const self = s.players.find((p) => p.id === this.net.playerId);
    if (self) {
      this.input.yaw = self.yaw;
      this.input.pitch = 0;
    }
    this.recoilPitch = this.recoilYaw = 0;
    this.vm.reset();
    this.vm.draw(WEAPONS[s.me.weapon.id].drawTime);
    this.vm.object.visible = true;
    this.hud.setAliveUi(true);
    this.hud.setCenter('');
    audio.play2D('spawn', 0.35);
  }

  private dieLocal(killer: number | null): void {
    if (!this.alive) return;
    this.alive = false;
    this.killerId = killer;
    this.deathPos.copy(this.camera.position);
    this.vm.reset();
    this.vm.object.visible = false;
    this.hud.setAliveUi(false);
    this.sendBuf = [];
  }

  onEvents(events: GameEvent[]): void {
    const myId = this.net.playerId;
    for (const e of events) {
      switch (e.k) {
        case 'shot': {
          const r = this.remotes.get(e.id);
          const origin = V(e.o);
          const end = V(e.e);
          const from = r && r.model.object.visible ? r.model.muzzle.getWorldPosition(new THREE.Vector3()) : origin;
          this.effects.tracer(from, end);
          this.effects.muzzleLight(from);
          r?.model.fire();
          if (e.n) {
            this.effects.impactWorld(end, V(e.n));
            if (end.distanceTo(this.camera.position) < 25) audio.play3D('impact', end, 0.35);
          } else if (e.hit !== undefined && e.hit !== myId) {
            this.effects.impactPlayer(end, end.clone().sub(origin).normalize(), false);
          }
          const dist = origin.distanceTo(this.camera.position);
          audio.play3D(dist > 35 ? 'shotFar' : 'shot', origin, 1, this.occluded(origin));
          break;
        }
        case 'hit': {
          if (e.dmg <= 0) break; // alvo protegido
          this.hud.hit(e.head, e.kill);
          audio.play2D(e.head ? 'headshot' : 'hit', e.head ? 0.7 : 0.5);
          const r = this.remotes.get(e.victim);
          if (r?.state) {
            const p = new THREE.Vector3(r.state.x, r.state.y + (e.head ? 1.66 : 1.2), r.state.z);
            this.effects.impactPlayer(p, p.clone().sub(this.camera.position).normalize(), e.head);
          }
          break;
        }
        case 'hurt': {
          this.hp = e.hp;
          const yaw = this.input.yaw;
          const dx = e.from[0] - this.predictor.state.pos.x;
          const dz = e.from[2] - this.predictor.state.pos.z;
          const fx = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
          const rx = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
          this.hud.hurt(Math.atan2(rx, fx), e.dmg);
          audio.play2D('hurt', 0.6);
          break;
        }
        case 'kill': {
          const killer = this.playerInfo(e.killer);
          const victim = this.playerInfo(e.victim);
          const assist = e.assist !== undefined ? this.playerInfo(e.assist) : undefined;
          this.hud.killfeed(killer, victim, e.head, myId, assist);
          if (e.victim === myId) {
            this.dieLocal(e.killer !== myId ? e.killer : null);
          } else {
            this.remotes.get(e.victim)?.model.setDead(true);
            if (e.killer === myId) {
              this.hud.showBanner(e.head ? `HEADSHOT · ${victim?.name ?? ''}` : `ELIMINOU ${victim?.name ?? ''}`, e.head ? 'head' : 'kill');
              audio.play2D('kill', 0.6);
            }
          }
          if (e.assist === myId) this.hud.showBanner(`ASSISTÊNCIA · ${victim?.name ?? ''}`, 'info');
          break;
        }
        case 'spawn': {
          const r = this.remotes.get(e.id);
          if (r) {
            r.interp.reset();
            r.model.setDead(false);
          }
          break;
        }
        case 'reload': {
          const r = this.remotes.get(e.id);
          if (r?.state) {
            r.model.reload();
            audio.play3D('magOut', V([r.state.x, r.state.y + 1.2, r.state.z]), 0.5, this.occluded(V([r.state.x, r.state.y + 1.2, r.state.z])));
          }
          break;
        }
        case 'leave': {
          const r = this.remotes.get(e.id);
          if (r) {
            r.dispose(this.scene);
            this.remotes.delete(e.id);
          }
          break;
        }
      }
    }
  }

  private occluded(pos: THREE.Vector3): boolean {
    const o = this.camera.position;
    const d = pos.clone().sub(o);
    const len = d.length();
    if (len < 0.5) return false;
    d.divideScalar(len);
    const hit = this.world.raycast(o, d, len - 0.3);
    return hit !== null;
  }

  // ---------- Loop ----------
  private frame = (t: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const raw = (t - this.last) / 1000;
    const dt = Math.min(0.25, raw);
    this.last = t;

    this.fpsFrames++;
    this.fpsTime += raw;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    this.simulate(dt);
    this.render(dt);
  };

  private simulate(dt: number): void {
    const def = WEAPONS[this.predictor.state.weapon.id];
    // Recuo visual recupera com o tempo
    const rec = Math.exp(-def.recoil.recover * dt);
    this.recoilPitch *= rec;
    this.recoilYaw *= rec;

    if (this.input.locked && this.alive && this.input.consume('KeyF')) this.vm.inspect();

    this.accum += dt;
    let steps = 0;
    while (this.accum >= SIM_DT && steps < 15) {
      this.accum -= SIM_DT;
      steps++;
      if (!this.alive) continue;
      const cmd: InputCmd = {
        seq: this.seq++,
        buttons: this.input.buttons(),
        yaw: this.input.yaw + this.recoilYaw,
        pitch: Math.max(-1.55, Math.min(1.55, this.input.pitch + this.recoilPitch)),
        viewTime: this.net.serverNow() - INTERP_DELAY_MS,
      };
      this.input.clearLatched();
      const wasGround = this.predictor.state.onGround;
      const velY = this.predictor.state.vel.y;
      const res = this.predictor.apply(cmd);
      this.sendBuf.push(cmd);
      const w = res.weapon;
      if (w.fired) this.onLocalFire(cmd, w.spread, w.shotIndex);
      if (w.reloadStarted) this.vm.reload(def.reloadTime);
      if (w.dryFire) {
        this.vm.dryFire();
        audio.play2D('dry', 0.6);
      }
      // Passos e aterrissagem
      const s = this.predictor.state;
      if (s.onGround && !wasGround && velY < -4) {
        this.landDip = Math.min(0.12, -velY * 0.012);
        audio.play2D('land', 0.4);
      }
      if (s.onGround) {
        const spd = Math.hypot(s.vel.x, s.vel.z);
        this.stepDist += spd * SIM_DT;
        const sprint = (cmd.buttons & Buttons.Sprint) !== 0 && spd > WALK_SPEED * 1.05;
        if (this.stepDist > (sprint ? 2.3 : 2.0)) {
          this.stepDist = 0;
          audio.play2D('step', sprint ? 0.5 : 0.3);
        }
      }
      if (this.accum > SIM_DT * 15) this.accum = 0; // evita espiral após travamentos
    }
    if (this.wasGround !== this.predictor.state.onGround) this.wasGround = this.predictor.state.onGround;

    // Envio em lotes (~30 Hz)
    const now = performance.now();
    if (this.sendBuf.length && (now - this.lastSend >= 1000 / INPUT_SEND_HZ - 2 || this.sendBuf.length >= MAX_CMDS_PER_BATCH)) {
      while (this.sendBuf.length) this.net.sendInput(this.sendBuf.splice(0, MAX_CMDS_PER_BATCH));
      this.lastSend = now;
    }
    this.predictor.decaySmoothing(dt);
  }

  private onLocalFire(cmd: InputCmd, spread: number, shotIndex: number): void {
    const def = WEAPONS[this.predictor.state.weapon.id];
    const s = this.predictor.state;
    const eye = new THREE.Vector3(s.pos.x, s.pos.y + EYE_HEIGHT, s.pos.z);
    const dirS = shotDirection(cmd.yaw, Math.max(-1.55, Math.min(1.55, cmd.pitch)), spread, this.net.playerId, shotIndex);
    const dir = V(dirS);
    // Ponto final previsto (o resultado real vem do servidor)
    const wh = this.world.raycast(eye, dir, def.range);
    let tEnd = wh ? wh.t : def.range;
    let hitPlayer = false;
    for (const r of this.remotes.values()) {
      if (!r.alive || !r.state) continue;
      for (const hb of hitboxesAt(r.state)) {
        const d = rayAABB(eye, dir, hb.box, tEnd);
        if (d >= 0 && d < tEnd) {
          tEnd = d;
          hitPlayer = true;
        }
      }
    }
    const end = eye.clone().addScaledVector(dir, tEnd);
    this.vm.fire();
    audio.play2D('shot', 0.85);
    // Traçante sai da arma: converte a boca do cano (espaço da câmera) para o mundo
    this.camera.updateMatrixWorld();
    const muzzle = this.vm.muzzlePosition(new THREE.Vector3()).applyMatrix4(this.camera.matrixWorld);
    this.effects.tracer(muzzle, end);
    this.effects.muzzleLight(muzzle);
    if (!hitPlayer && wh) {
      const n = wh.box;
      const normal = new THREE.Vector3();
      const eps = 0.01;
      if (Math.abs(end.x - n.min.x) < eps) normal.set(-1, 0, 0);
      else if (Math.abs(end.x - n.max.x) < eps) normal.set(1, 0, 0);
      else if (Math.abs(end.y - n.min.y) < eps) normal.set(0, -1, 0);
      else if (Math.abs(end.y - n.max.y) < eps) normal.set(0, 1, 0);
      else if (Math.abs(end.z - n.min.z) < eps) normal.set(0, 0, -1);
      else normal.set(0, 0, 1);
      this.effects.impactWorld(end, normal);
    }
    this.recoilPitch += def.recoil.pitch;
    this.recoilYaw += (Math.random() - 0.5) * 2 * def.recoil.yawJitter;
  }

  private render(dt: number): void {
    const s = this.predictor.state;
    const alpha = Math.min(1, this.accum / SIM_DT);
    const prev = this.predictor.prev.pos;
    const sm = this.predictor.smoothing;
    this.landDip *= Math.exp(-dt * 9);

    if (this.alive) {
      this.camera.position.set(
        prev.x + (s.pos.x - prev.x) * alpha + sm.x,
        prev.y + (s.pos.y - prev.y) * alpha + sm.y + EYE_HEIGHT - this.landDip,
        prev.z + (s.pos.z - prev.z) * alpha + sm.z,
      );
      this.camera.rotation.set(this.input.pitch + this.recoilPitch, this.input.yaw + this.recoilYaw, 0, 'YXZ');
    } else {
      // Câmera de eliminação: desce e olha para quem eliminou
      const target = this.killerId !== null ? this.remotes.get(this.killerId) : undefined;
      this.camera.position.lerp(new THREE.Vector3(this.deathPos.x, this.deathPos.y - 1.1, this.deathPos.z), Math.min(1, dt * 3));
      if (target?.state) {
        const look = new THREE.Vector3(target.state.x, target.state.y + 1.5, target.state.z);
        const m = new THREE.Matrix4().lookAt(this.camera.position, look, new THREE.Vector3(0, 1, 0));
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        this.camera.quaternion.slerp(q, Math.min(1, dt * 4));
      }
      const left = Math.max(0, this.respawnAt - this.net.serverNow());
      const killer = this.killerId !== null ? this.playerInfo(this.killerId) : undefined;
      this.hud.setCenter(killer ? `ELIMINADO POR ${killer.name}` : 'ELIMINADO', `Renascendo em ${(left / 1000).toFixed(1)} s`);
    }

    const renderTime = this.net.serverNow() - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) r.update(renderTime, dt);

    // Viewmodel
    const spd = Math.hypot(s.vel.x, s.vel.z);
    const btn = this.input.buttons();
    this.vm.update(dt, {
      speed: spd,
      sprinting: (btn & Buttons.Sprint) !== 0 && (btn & Buttons.Forward) !== 0,
      onGround: s.onGround,
      velY: s.vel.y,
      lookDX: this.input.lookDX,
      lookDY: this.input.lookDY,
      reloading: s.weapon.reloadLeft > 0,
    });
    this.input.lookDX = this.input.lookDY = 0;
    this.effects.update(dt);

    // Áudio: ouvinte na câmera
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    audio.setListener(this.camera.position, fwd);

    // HUD
    const def = WEAPONS[s.weapon.id];
    const ws = s.weapon;
    this.hud.setHealth(this.alive ? this.hp : 0);
    this.hud.setAmmo(def.name, ws.ammo, ws.reserve, ws.reloadLeft > 0 ? 1 - ws.reloadLeft / def.reloadTime : 0);
    const spread = currentSpread(def, ws, { horizontalSpeed: spd, onGround: s.onGround, sprinting: (btn & Buttons.Sprint) !== 0, walkSpeed: WALK_SPEED });
    this.hud.setCrosshair(spread, this.camera.fov, this.alive);
    this.hud.setTimer(this.match.endsAt - this.net.serverNow());
    const players = this.net.room?.players ?? [];
    const aliveCount = [...this.hpById.entries()].filter(([id, hp]) => hp > 0 && players.some((p) => p.id === id && p.connected)).length;
    this.hud.setScore(this.playerInfo(this.net.playerId), players, this.match.killLimit, aliveCount);
    this.hud.setNet(this.fps, this.net.rtt, settings.showFps);
    this.hud.setProtected(this.alive && performance.now() < this.protectedUntil);
    this.hud.showScoreboard(this.input.isDown('Tab'), players, this.net.playerId, this.hpById);
    this.hud.update(dt);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.alive) {
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
  }

  /** Estatísticas de rede para o painel de diagnóstico. */
  get debug() {
    return { corrections: this.predictor.corrections, lastError: this.predictor.lastError, remotes: this.remotes.size, alive: this.alive };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    for (const r of this.remotes.values()) r.dispose(this.scene);
    this.remotes.clear();
    this.map.dispose();
    this.effects.dispose();
    this.vm.dispose();
    this.hud.dispose();
    this.envTex?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
