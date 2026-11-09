/** Validação de payloads recebidos. Qualquer dado vindo do cliente passa por aqui. */
import {
  KILL_LIMIT_OPTIONS,
  MAX_CMDS_PER_BATCH,
  NAME_MAX_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
  TIME_LIMIT_OPTIONS_MIN,
} from './constants';
import { MAPS } from './maps';
import { BUTTONS_MASK, type InputCmd, type RoomConfig } from './protocol';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function sanitizeName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // Remove caracteres de controle e espaços repetidos.
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
  return s.length >= 2 ? s : null;
}

export function sanitizeCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  if (s.length !== ROOM_CODE_LENGTH) return null;
  for (const c of s) if (!ROOM_CODE_ALPHABET.includes(c)) return null;
  return s;
}

export function validateCmd(v: unknown): InputCmd | null {
  if (!isObj(v)) return null;
  const { seq, buttons, yaw, pitch, viewTime } = v;
  if (!Number.isInteger(seq) || (seq as number) < 0 || (seq as number) > 2 ** 31) return null;
  if (!Number.isInteger(buttons) || (buttons as number) < 0 || ((buttons as number) & ~BUTTONS_MASK) !== 0) return null;
  if (!isFiniteNum(yaw) || Math.abs(yaw) > 1e4) return null;
  if (!isFiniteNum(pitch) || Math.abs(pitch) > 2) return null;
  if (!isFiniteNum(viewTime) || viewTime < 0) return null;
  return { seq: seq as number, buttons: buttons as number, yaw, pitch, viewTime };
}

export function validateCmdBatch(v: unknown): InputCmd[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_CMDS_PER_BATCH) return null;
  const out: InputCmd[] = [];
  for (const c of v) {
    const cmd = validateCmd(c);
    if (!cmd) return null;
    out.push(cmd);
  }
  return out;
}

export function validateConfigPatch(v: unknown): Partial<RoomConfig> | null {
  if (!isObj(v)) return null;
  const out: Partial<RoomConfig> = {};
  if (v.maxPlayers !== undefined) {
    if (!Number.isInteger(v.maxPlayers)) return null;
    const n = v.maxPlayers as number;
    if (n < ROOM_MIN_PLAYERS || n > ROOM_MAX_PLAYERS) return null;
    out.maxPlayers = n;
  }
  if (v.killLimit !== undefined) {
    if (!(KILL_LIMIT_OPTIONS as readonly unknown[]).includes(v.killLimit)) return null;
    out.killLimit = v.killLimit as number;
  }
  if (v.timeLimitMin !== undefined) {
    if (!(TIME_LIMIT_OPTIONS_MIN as readonly unknown[]).includes(v.timeLimitMin)) return null;
    out.timeLimitMin = v.timeLimitMin as number;
  }
  if (v.map !== undefined) {
    if (typeof v.map !== 'string' || !MAPS[v.map]) return null;
    out.map = v.map;
  }
  if (v.mode !== undefined) {
    if (v.mode !== 'deathmatch') return null;
    out.mode = 'deathmatch';
  }
  return out;
}
