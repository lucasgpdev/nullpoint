/**
 * Protocolo de rede. Todas as mensagens trocadas entre cliente e servidor estão tipadas aqui.
 * Mudanças incompatíveis devem incrementar PROTOCOL_VERSION.
 */
import type { WeaponState } from './weapons';

export const Buttons = {
  Forward: 1 << 0,
  Back: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Jump: 1 << 4,
  Sprint: 1 << 5,
  Fire: 1 << 6,
  Reload: 1 << 7,
} as const;
export const BUTTONS_MASK = (1 << 8) - 1;

/** Um comando = uma amostra de entrada de duração SIM_DT. */
export interface InputCmd {
  seq: number;
  buttons: number;
  yaw: number;
  pitch: number;
  /** Tempo do servidor (ms) que o cliente estava renderizando ao gerar o comando. */
  viewTime: number;
}

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export interface RoomConfig {
  maxPlayers: number;
  mode: 'deathmatch';
  map: string;
  killLimit: number;
  timeLimitMin: number;
}

export interface PlayerInfo {
  id: number;
  name: string;
  color: number;
  connected: boolean;
  ping: number;
  isHost: boolean;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  score: number;
}

export interface RoomState {
  code: string;
  phase: RoomPhase;
  config: RoomConfig;
  players: PlayerInfo[];
  hostId: number;
  /** Tempo do servidor em que a partida termina por tempo (se em jogo). */
  matchEndsAt?: number;
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  playerId?: number;
  token?: string;
  room?: RoomState;
}

/** Estado completo de um jogador remoto em um snapshot. */
export interface NetPlayer {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Velocidade horizontal (para animação de caminhada). */
  spd: number;
  /** bit0 vivo, bit1 no chão, bit2 recarregando, bit3 protegido */
  f: number;
  hp: number;
}

export const NetFlags = { Alive: 1, Ground: 2, Reloading: 4, Protected: 8 } as const;

/** Estado autoritativo do próprio jogador, usado na reconciliação. */
export interface NetSelf {
  ack: number;
  pos: [number, number, number];
  vel: [number, number, number];
  onGround: boolean;
  weapon: WeaponState;
  hp: number;
  alive: boolean;
  respawnAt: number;
}

export interface Snapshot {
  t: number;
  tick: number;
  players: NetPlayer[];
  me: NetSelf;
}

export type GameEvent =
  | {
      k: 'shot';
      id: number;
      o: [number, number, number];
      e: [number, number, number];
      /** normal da superfície atingida (se mundo) */
      n?: [number, number, number];
      hit?: number;
    }
  | { k: 'hit'; victim: number; dmg: number; head: boolean; kill: boolean }
  | { k: 'hurt'; from: [number, number, number]; dmg: number; hp: number }
  | { k: 'kill'; killer: number; victim: number; head: boolean; weapon: string; assist?: number }
  | { k: 'spawn'; id: number; pos: [number, number, number]; yaw: number }
  | { k: 'reload'; id: number }
  | { k: 'leave'; id: number };

export interface MatchStart {
  map: string;
  startedAt: number;
  endsAt: number;
  killLimit: number;
}

export interface MatchEnd {
  winnerId: number | null;
  reason: 'kills' | 'time' | 'host' | 'players';
  players: PlayerInfo[];
  backToLobbyAt: number;
}

export interface ServerToClient {
  'room:state': (s: RoomState) => void;
  'match:start': (m: MatchStart) => void;
  'match:end': (m: MatchEnd) => void;
  snap: (s: Snapshot) => void;
  ev: (events: GameEvent[]) => void;
  kicked: (reason: string) => void;
}

export interface ClientToServer {
  'room:create': (p: { name: string }, ack: (r: JoinResult) => void) => void;
  'room:join': (p: { name: string; code: string }, ack: (r: JoinResult) => void) => void;
  'room:rejoin': (p: { token: string }, ack: (r: JoinResult) => void) => void;
  'room:config': (p: Partial<RoomConfig>) => void;
  'room:start': (ack: (r: { ok: boolean; error?: string }) => void) => void;
  'room:end': () => void;
  'room:leave': () => void;
  input: (cmds: InputCmd[]) => void;
  'net:ping': (p: { t: number; rtt: number }, ack: (serverTime: number) => void) => void;
}
