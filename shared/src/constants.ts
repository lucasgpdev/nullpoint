/** Valores globais compartilhados entre cliente e servidor. Alterar aqui muda os dois lados. */

export const GAME_NAME = 'NULLPOINT';
export const PROTOCOL_VERSION = 1;

// ---- Rede / tempo ----
/** Passo fixo da simulação (cliente e servidor). */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
/** Frequência do loop do servidor. */
export const SERVER_TICK_HZ = 60;
/** Frequência de envio de snapshots. */
export const SNAPSHOT_HZ = 30;
/** Frequência de envio de lotes de comandos pelo cliente. */
export const INPUT_SEND_HZ = 30;
/** Atraso de interpolação dos jogadores remotos (ms). */
export const INTERP_DELAY_MS = 100;
/** Máximo que o servidor rebobina o mundo para validar um disparo (ms). */
export const MAX_LAG_COMP_MS = 250;
/** Duração do histórico de hitboxes guardado pelo servidor (ms). */
export const HISTORY_MS = 1000;
/** Máximo de comandos por lote. */
export const MAX_CMDS_PER_BATCH = 16;
/** Comandos que podem ficar na fila do servidor por jogador. */
export const MAX_CMD_QUEUE = 24;
/** Rajada máxima de comandos acumulados no orçamento (anti speed hack). */
export const CMD_BUDGET_MAX = 12;

// ---- Jogador ----
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
export const MAX_HEALTH = 100;
export const RESPAWN_DELAY_MS = 3000;
export const SPAWN_PROTECTION_MS = 1200;
export const PITCH_LIMIT = 1.55;

// ---- Física (metros, segundos) ----
export const GRAVITY = 20;
export const JUMP_VELOCITY = 6.4;
export const WALK_SPEED = 4.4;
export const SPRINT_SPEED = 6.2;
export const GROUND_ACCEL = 11;
export const AIR_ACCEL = 1.6;
export const FRICTION = 7;
export const STOP_SPEED = 1.6;
export const STEP_HEIGHT = 0.5;
export const SNAP_DOWN = 0.3;
export const KILL_PLANE_Y = -25;

// ---- Salas ----
export const ROOM_CODE_LENGTH = 6;
/** Sem 0/O/1/I/L para evitar confusão ao ditar o código. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_MIN_PLAYERS = 2;
export const ROOM_MAX_PLAYERS = 10;
export const NAME_MAX_LENGTH = 16;
export const RECONNECT_GRACE_MS = 30000;
export const RESULTS_SCREEN_MS = 12000;
export const KILL_LIMIT_OPTIONS = [5, 10, 20, 30] as const;
export const TIME_LIMIT_OPTIONS_MIN = [5, 10, 15] as const;
