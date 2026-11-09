import type * as THREE from 'three';

export interface ViewModelContext {
  /** Velocidade horizontal (m/s). */
  speed: number;
  sprinting: boolean;
  onGround: boolean;
  velY: number;
  lookDX: number;
  lookDY: number;
  reloading: boolean;
}

/**
 * Contrato de um modelo de arma em primeira pessoa.
 * Implementações: procedural (Fase 1) ou GLB com AnimationMixer (pipeline Blender).
 * As mecânicas só conversam com esta interface, então trocar o modelo não exige reescrever o jogo.
 */
export interface ViewModel {
  readonly object: THREE.Object3D;
  draw(duration: number): void;
  fire(): void;
  dryFire(): void;
  reload(duration: number): void;
  inspect(): void;
  /** Cancela animações em curso (ex.: morte). */
  reset(): void;
  update(dt: number, ctx: ViewModelContext): void;
  /** Posição da boca do cano no espaço da câmera. */
  muzzlePosition(out: THREE.Vector3): THREE.Vector3;
  /** Eventos de animação (sons de recarga etc.). */
  onAnimEvent?: (name: string) => void;
  dispose(): void;
}
