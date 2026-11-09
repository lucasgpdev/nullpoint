/**
 * Teste de integração: servidor real + dois clientes Socket.IO reais.
 * Cobre o critério da Fase 1 e as proteções do servidor autoritativo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Buttons, eyePosition, getCollisionWorld, WALK_SPEED, type GameEvent } from '@nullpoint/shared';
import { startServer, type StartedServer } from '../server/src/index';
import { sleep, TestClient, waitFor } from './helpers';

let server: StartedServer;
let url: string;
const clients: TestClient[] = [];
const client = async () => {
  const c = new TestClient(url);
  clients.push(c);
  await c.connected();
  return c;
};

beforeAll(async () => {
  server = await startServer(0, null);
  url = `http://localhost:${server.port}`;
});
afterAll(async () => {
  clients.forEach((c) => c.close());
  await server.close();
});

/** Acesso ao estado interno do servidor apenas para posicionar jogadores no teste. */
const serverPlayer = (code: string, id: number) => server.manager.rooms.get(code)!.players.get(id)!;
const placeBoth = (code: string, a: TestClient, b: TestClient) => {
  const pa = serverPlayer(code, a.playerId);
  const pb = serverPlayer(code, b.playerId);
  pa.sim.pos = { x: -10, y: 0, z: -22.5 };
  pa.sim.vel = { x: 0, y: 0, z: 0 };
  pb.sim.pos = { x: -2, y: 0, z: -22.5 };
  pb.sim.vel = { x: 0, y: 0, z: 0 };
  pb.protectedUntil = 0;
  pa.sim.weapon.drawLeft = 0;
  return { pa, pb };
};

describe('Fase 1 — multiplayer com dois jogadores reais', () => {
  let a: TestClient;
  let b: TestClient;
  let code: string;

  it('cria sala com código e o segundo jogador entra pelo código', async () => {
    a = await client();
    b = await client();
    const ra = await a.create('Lucas');
    expect(ra.ok).toBe(true);
    code = ra.room!.code;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    const bad = await b.join('Amigo', 'ZZZZZZ');
    expect(bad.ok).toBe(false);

    const rb = await b.join('Amigo', code.toLowerCase());
    expect(rb.ok).toBe(true);
    await waitFor(() => a.room?.players.length === 2 && a.room, 3000, 'lobby com 2 jogadores');
    expect(a.room!.players.map((p) => p.name).sort()).toEqual(['Amigo', 'Lucas']);
    expect(a.room!.hostId).toBe(a.playerId);
  });

  it('somente o anfitrião inicia a partida', async () => {
    expect((await b.start()).ok).toBe(false);
    const r = await a.start();
    expect(r.ok).toBe(true);
    await waitFor(() => a.last && b.last, 3000, 'snapshots');
    expect(a.last!.players.map((p) => p.id).sort()).toEqual([a.playerId, b.playerId].sort());
  });

  it('movimentação de A é simulada pelo servidor e vista por B', async () => {
    placeBoth(code, a, b);
    await sleep(100);
    const yaw = -Math.PI / 2; // olhando para +X
    await a.play(30, () => ({ buttons: Buttons.Forward, yaw }));
    await sleep(150);
    const seen = b.last!.players.find((p) => p.id === a.playerId)!;
    expect(seen.x).toBeGreaterThan(-9.5);
    expect(seen.yaw).toBeCloseTo(yaw, 2);
    // A recebe o ack dos comandos para reconciliar
    expect(a.last!.me.ack).toBe(a.seq - 1);
  });

  it('A elimina B com headshot validado pelo servidor', async () => {
    const { pa, pb } = placeBoth(code, a, b);
    await sleep(150);
    const eye = eyePosition(pa.sim.pos);
    const head = { x: pb.sim.pos.x, y: pb.sim.pos.y + 1.66, z: pb.sim.pos.z };
    const dx = head.x - eye.x;
    const dz = head.z - eye.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(head.y - eye.y, Math.hypot(dx, dz));
    // Linha de visão livre
    const dist = Math.hypot(dx, head.y - eye.y, dz);
    const dir = { x: dx / dist, y: (head.y - eye.y) / dist, z: dz / dist };
    const wall = getCollisionWorld('foundry').raycast(eye, dir, dist);
    expect(wall).toBeNull();

    a.events = [];
    b.events = [];
    await a.play(8, (i) => ({ buttons: i === 2 ? Buttons.Fire : 0, yaw, pitch }));
    const kill = await waitFor(() => b.events.find((e) => e.k === 'kill'), 3000, 'evento de abate') as Extract<GameEvent, { k: 'kill' }>;
    expect(kill.killer).toBe(a.playerId);
    expect(kill.victim).toBe(b.playerId);
    expect(kill.head).toBe(true);
    const hit = a.events.find((e) => e.k === 'hit') as Extract<GameEvent, { k: 'hit' }>;
    expect(hit.head && hit.kill).toBe(true);
    expect(b.events.some((e) => e.k === 'shot' && e.id === a.playerId)).toBe(true);
    await waitFor(() => a.room?.players.find((p) => p.id === a.playerId)?.kills === 1, 3000, 'placar');
    expect(a.room!.players.find((p) => p.id === b.playerId)!.deaths).toBe(1);
  });

  it('B renasce após o tempo de respawn', async () => {
    await waitFor(() => b.events.find((e) => e.k === 'spawn' && e.id === b.playerId), 5000, 'respawn');
    await waitFor(() => b.last?.me.alive, 2000, 'vivo');
    expect(b.last!.me.hp).toBe(100);
  });

  it('anti-cadência: clicar a cada quadro não supera a cadência da arma', async () => {
    const { pa } = placeBoth(code, a, b);
    const ammoBefore = pa.sim.weapon.ammo;
    const reserveBefore = pa.sim.weapon.reserve;
    // 60 comandos (1 s) alternando o gatilho; mirando para a parede ao fundo
    await a.play(60, (i) => ({ buttons: i % 2 ? 0 : Buttons.Fire, yaw: 0, pitch: 0 }));
    await sleep(200);
    const used = ammoBefore + reserveBefore - (pa.sim.weapon.ammo + pa.sim.weapon.reserve);
    expect(used).toBeLessThanOrEqual(8); // 1 s / 0,15 s ≈ 7 disparos
    expect(used).toBeGreaterThanOrEqual(3);
  });

  it('anti speed hack: excesso de comandos não acelera o jogador', async () => {
    const { pa } = placeBoth(code, a, b);
    pa.sim.pos = { x: -14, y: 0, z: -22.5 };
    pa.queue = [];
    await sleep(100);
    const x0 = pa.sim.pos.x;
    const t0 = Date.now();
    // Tenta enviar 10× mais comandos do que o tempo real permite (16 por lote, ~45 lotes/s).
    for (let k = 0; k < 20; k++) {
      a.send(Array.from({ length: 16 }, () => a.cmd(Buttons.Forward, -Math.PI / 2)));
      await sleep(25);
    }
    const elapsed = (Date.now() - t0 + 100) / 1000;
    await sleep(100);
    const moved = pa.sim.pos.x - x0;
    // Com orçamento por tempo real, o deslocamento fica limitado à velocidade legítima (+ pequena rajada).
    expect(moved).toBeLessThanOrEqual(WALK_SPEED * (elapsed + 0.25));
    expect(moved).toBeGreaterThan(0.5);
  });

  it('mensagens inválidas são descartadas sem derrubar o servidor', async () => {
    const s = a.socket as unknown as { emit: (...args: unknown[]) => void };
    s.emit('input', 'lixo');
    s.emit('input', [{ seq: -1, buttons: 9999, yaw: 'x' }]);
    s.emit('room:config', { maxPlayers: 9999 });
    await sleep(200);
    expect(a.socket.connected).toBe(true);
    expect(server.manager.rooms.get(code)!.config.maxPlayers).toBe(10);
  });

  it('reconexão: B cai e volta com o token mantendo o mesmo jogador', async () => {
    const id = b.playerId;
    const token = b.token;
    b.close();
    await waitFor(() => a.room?.players.find((p) => p.id === id)?.connected === false, 3000, 'desconexão detectada');
    const b2 = await client();
    const r = await b2.rejoin(token);
    expect(r.ok).toBe(true);
    expect(r.playerId).toBe(id);
    await waitFor(() => a.room?.players.find((p) => p.id === id)?.connected, 3000, 'reconectado');
    await waitFor(() => b2.last, 3000, 'snapshots após reconexão');
    expect(a.room!.players.find((p) => p.id === id)!.deaths).toBe(1);
    b = b2;
  });

  it('partida termina ao atingir o limite de abates', async () => {
    const s = a.socket;
    let ended: unknown = null;
    s.once('match:end', (m) => (ended = m));
    const room = server.manager.rooms.get(code)!;
    room.players.get(a.playerId)!.kills = room.config.killLimit - 1;
    // Mais um abate
    const { pa, pb } = placeBoth(code, a, b);
    await waitFor(() => pb.alive, 5000, 'B vivo');
    placeBoth(code, a, b);
    await sleep(150);
    const eye = eyePosition(pa.sim.pos);
    const dx = pb.sim.pos.x - eye.x;
    const dz = pb.sim.pos.z - eye.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(pb.sim.pos.y + 1.66 - eye.y, Math.hypot(dx, dz));
    await a.play(8, (i) => ({ buttons: i === 2 ? Buttons.Fire : 0, yaw, pitch }));
    await waitFor(() => ended, 3000, 'fim de partida');
    expect((ended as { winnerId: number }).winnerId).toBe(a.playerId);
    await waitFor(() => a.room?.phase === 'ended', 2000, 'fase ended');
  });
});
