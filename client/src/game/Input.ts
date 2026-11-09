import { Buttons, PITCH_LIMIT } from '@nullpoint/shared';
import { settings } from '../config/settings';

const BASE_SENS = 0.0022;

/** Teclado + mouse com pointer lock. Gera bitmask de botões e acumula ângulos de visão. */
export class Input {
  yaw = 0;
  pitch = 0;
  /** Deslocamento do mouse no último quadro (para o balanço da arma). */
  lookDX = 0;
  lookDY = 0;
  private keys = new Set<string>();
  private mouse = new Set<number>();
  private pressedOnce = new Set<string>();
  /** Cliques/teclas rápidos entre dois quadros não se perdem: ficam retidos até o próximo comando. */
  private latched = 0;
  locked = false;
  enabled = true;
  onLockChange?: (locked: boolean) => void;

  constructor(private readonly element: HTMLElement) {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onLock);
    window.addEventListener('blur', this.clear);
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock(): void {
    const el = this.element as HTMLElement & { requestPointerLock(o?: unknown): Promise<void> | void };
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => el.requestPointerLock());
      }
    } catch {
      el.requestPointerLock();
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onLock = () => {
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) this.clear();
    this.onLockChange?.(this.locked);
  };

  private clear = () => {
    this.latched = 0;
    this.keys.clear();
    this.mouse.clear();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.locked) return;
    if (['Tab', 'Space', 'ControlLeft', 'ControlRight'].includes(e.code)) e.preventDefault();
    if (!this.keys.has(e.code)) {
      this.pressedOnce.add(e.code);
      if (e.code === 'Space') this.latched |= Buttons.Jump;
      if (e.code === 'KeyR') this.latched |= Buttons.Reload;
    }
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked) return;
    this.mouse.add(e.button);
    if (e.button === 0) this.latched |= Buttons.Fire;
  };
  private onMouseUp = (e: MouseEvent) => {
    this.mouse.delete(e.button);
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked || !this.enabled) return;
    // Descarta saltos espúrios que alguns navegadores geram ao capturar o ponteiro.
    if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
    const s = BASE_SENS * settings.sensitivity;
    this.yaw -= e.movementX * s;
    this.pitch -= e.movementY * s * (settings.invertY ? -1 : 1);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    this.lookDX += e.movementX;
    this.lookDY += e.movementY;
  };

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Verdadeiro uma única vez por pressionamento. */
  consume(code: string): boolean {
    const had = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return had;
  }

  buttons(): number {
    if (!this.enabled || !this.locked) return 0;
    let b = 0;
    if (this.keys.has('KeyW')) b |= Buttons.Forward;
    if (this.keys.has('KeyS')) b |= Buttons.Back;
    if (this.keys.has('KeyA')) b |= Buttons.Left;
    if (this.keys.has('KeyD')) b |= Buttons.Right;
    if (this.keys.has('Space')) b |= Buttons.Jump;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) b |= Buttons.Sprint;
    if (this.mouse.has(0)) b |= Buttons.Fire;
    if (this.keys.has('KeyR')) b |= Buttons.Reload;
    return b | this.latched;
  }

  /** Chamado após gerar um comando: libera os pressionamentos retidos. */
  clearLatched(): void {
    this.latched = 0;
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onLock);
    window.removeEventListener('blur', this.clear);
    this.exitLock();
  }
}
