/**
 * Áudio sintetizado em tempo real com WebAudio (todos os sons são originais, gerados por código).
 * Sons do mundo usam PannerNode HRTF (distância e direção) e filtro de oclusão quando há parede no caminho.
 */
import { settings, onSettingsChange } from '../config/settings';

export type SoundName =
  | 'shot'
  | 'shotFar'
  | 'dry'
  | 'magOut'
  | 'magIn'
  | 'slide'
  | 'draw'
  | 'step'
  | 'land'
  | 'hit'
  | 'headshot'
  | 'kill'
  | 'hurt'
  | 'impact'
  | 'uiHover'
  | 'uiClick'
  | 'spawn';

type Vec = { x: number; y: number; z: number };

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ui!: GainNode;
  private buffers = new Map<SoundName, AudioBuffer[]>();
  private unsub: (() => void) | null = null;

  /** Precisa ser chamado após um gesto do usuário (política dos navegadores). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.ui = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.sfx.connect(this.master);
    this.ui.connect(this.master);
    this.master.connect(comp).connect(this.ctx.destination);
    this.applyVolumes();
    this.unsub = onSettingsChange(() => this.applyVolumes());
    this.synthesizeAll();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = settings.masterVolume;
    this.sfx.gain.value = settings.sfxVolume;
    this.ui.gain.value = 0.6;
  }

  setListener(pos: Vec, forward: Vec): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(forward.x, t);
      l.forwardY.setValueAtTime(forward.y, t);
      l.forwardZ.setValueAtTime(forward.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
      (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  /** Som não posicional (próprio jogador / interface). */
  play2D(name: SoundName, volume = 1, rate = 1, ui = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = this.source(name, rate);
    if (!src) return;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(ui ? this.ui : this.sfx);
    src.start();
  }

  /** Som posicional no mundo. `occluded` aplica filtro passa-baixa (atrás de paredes). */
  play3D(name: SoundName, pos: Vec, volume = 1, occluded = false, rate = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = this.source(name, rate);
    if (!src) return;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2.5;
    panner.rolloffFactor = 1.1;
    panner.maxDistance = 120;
    if (panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    } else {
      (panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    }
    const g = ctx.createGain();
    g.gain.value = volume;
    let node: AudioNode = src;
    if (occluded) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      node = node.connect(f);
      g.gain.value *= 0.6;
    }
    node.connect(g).connect(panner).connect(this.sfx);
    src.start();
  }

  private source(name: SoundName, rate: number): AudioBufferSourceNode | null {
    const list = this.buffers.get(name);
    if (!list || !this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
    return src;
  }

  // ---------- Síntese ----------
  private synthesizeAll(): void {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const make = (dur: number, fn: (t: number, i: number) => number): AudioBuffer => {
      const n = Math.floor(dur * sr);
      const buf = ctx.createBuffer(1, n, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = fn(i / sr, i);
      // normaliza
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
      if (peak > 0) for (let i = 0; i < n; i++) d[i] /= peak;
      return buf;
    };
    const noise = () => Math.random() * 2 - 1;
    /** Ruído filtrado simples (passa-baixa de 1 polo). */
    const lp = (alpha: number) => {
      let y = 0;
      return (x: number) => (y += alpha * (x - y));
    };

    const shot = (far: boolean) => {
      const f1 = lp(far ? 0.08 : 0.5);
      const f2 = lp(0.04);
      return make(far ? 0.9 : 0.55, (t) => {
        const crack = noise() * Math.exp(-t * (far ? 30 : 55));
        const body = f1(noise()) * Math.exp(-t * (far ? 7 : 11)) * 1.4;
        const thump = Math.sin(2 * Math.PI * (110 - t * 120) * t) * Math.exp(-t * 18) * 0.9;
        const tail = f2(noise()) * Math.exp(-t * 3.2) * 0.8;
        return (far ? 0.2 : 0.8) * crack + body + thump + tail;
      });
    };
    const click = (freq: number, dur: number, decay: number, noiseAmt = 0.6) =>
      make(dur, (t) => (Math.sin(2 * Math.PI * freq * t) * (1 - noiseAmt) + noise() * noiseAmt) * Math.exp(-t * decay));

    this.buffers.set('shot', [shot(false), shot(false), shot(false)]);
    this.buffers.set('shotFar', [shot(true), shot(true)]);
    this.buffers.set('dry', [click(2400, 0.06, 90, 0.5)]);
    this.buffers.set('magOut', [
      make(0.25, (t) => (noise() * Math.exp(-t * 60) + Math.sin(2 * Math.PI * 900 * t) * Math.exp(-t * 40) * 0.6) + (t > 0.09 ? noise() * Math.exp(-(t - 0.09) * 50) * 0.4 : 0)),
    ]);
    this.buffers.set('magIn', [
      make(0.22, (t) => noise() * Math.exp(-t * 35) * 0.5 + (t > 0.05 ? (Math.sin(2 * Math.PI * 1500 * t) * 0.5 + noise()) * Math.exp(-(t - 0.05) * 70) : 0)),
    ]);
    this.buffers.set('slide', [
      make(0.3, (t) => {
        const rack = t < 0.08 ? noise() * 0.4 * Math.sin((t / 0.08) * Math.PI) : 0;
        const snap = t > 0.1 ? (noise() + Math.sin(2 * Math.PI * 2100 * t) * 0.5) * Math.exp(-(t - 0.1) * 60) : 0;
        return rack + snap;
      }),
    ]);
    this.buffers.set('draw', [make(0.2, (t) => noise() * 0.3 * Math.sin(Math.min(1, t / 0.2) * Math.PI) + (t > 0.12 ? noise() * Math.exp(-(t - 0.12) * 80) * 0.6 : 0))]);
    const steps: AudioBuffer[] = [];
    for (let k = 0; k < 4; k++) {
      const f = lp(0.06 + k * 0.015);
      const f2 = lp(0.3);
      steps.push(make(0.16, (t) => f(noise()) * Math.exp(-t * 32) * 1.5 + f2(noise()) * Math.exp(-t * 90) * 0.3));
    }
    this.buffers.set('step', steps);
    const lf = lp(0.03);
    this.buffers.set('land', [make(0.25, (t) => lf(noise()) * Math.exp(-t * 18) + Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 25) * 0.6)]);
    this.buffers.set('hit', [make(0.08, (t) => Math.sin(2 * Math.PI * 1900 * t) * Math.exp(-t * 55))]);
    this.buffers.set('headshot', [make(0.25, (t) => (Math.sin(2 * Math.PI * 2600 * t) + Math.sin(2 * Math.PI * 3900 * t) * 0.5) * Math.exp(-t * 16))]);
    this.buffers.set('kill', [
      make(0.35, (t) => (Math.sin(2 * Math.PI * (t < 0.1 ? 880 : 1320) * t) * 0.8 + Math.sin(2 * Math.PI * 440 * t) * 0.3) * Math.exp(-t * 9)),
    ]);
    const hf = lp(0.05);
    this.buffers.set('hurt', [make(0.25, (t) => hf(noise()) * Math.exp(-t * 14) + Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 20))]);
    this.buffers.set('impact', [click(800, 0.1, 60, 0.85), click(1200, 0.1, 70, 0.85), click(600, 0.12, 50, 0.9)]);
    this.buffers.set('uiHover', [make(0.04, (t) => Math.sin(2 * Math.PI * 1600 * t) * Math.exp(-t * 120))]);
    this.buffers.set('uiClick', [make(0.08, (t) => Math.sin(2 * Math.PI * (900 + t * 4000) * t) * Math.exp(-t * 60))]);
    this.buffers.set('spawn', [make(0.5, (t) => Math.sin(2 * Math.PI * (300 + t * 500) * t) * Math.exp(-t * 6) * 0.7)]);
  }

  dispose(): void {
    this.unsub?.();
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
