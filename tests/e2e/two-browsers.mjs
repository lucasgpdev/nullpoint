/**
 * Teste ponta a ponta: servidor de produção + DOIS navegadores Chrome independentes.
 * Fluxo real de usuário: criar sala, entrar pelo link de convite, iniciar, mover, atirar e eliminar.
 *
 * Uso: npm run build && npm run test:e2e
 * Variáveis: CHROME_PATH (padrão: chromium do Playwright ou /usr/bin/google-chrome), E2E_PORT, E2E_SHOTS (pasta de capturas)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = Number(process.env.E2E_PORT ?? 3199);
const URL = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS ?? 'tests/e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[e2e]', ...a);
let failures = 0;
const check = (cond, msg) => {
  if (cond) log('✔', msg);
  else {
    failures++;
    console.error('[e2e] ✘', msg);
  }
};

const server = spawn(process.execPath, ['server/dist/index.js'], { env: { ...process.env, PORT: String(PORT), NULLPOINT_TEST_HOOKS: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes('ouvindo') && res());
  server.on('exit', (c) => rej(new Error(`servidor saiu (${c})`)));
});
log('servidor no ar em', URL);

const executablePath = process.env.CHROME_PATH ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const browserOpts = {
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
};
// Dois processos de navegador separados = dois computadores diferentes.
const browserA = await chromium.launch(browserOpts);
const browserB = await chromium.launch(browserOpts);
const viewport = { width: Number(process.env.E2E_W ?? 800), height: Number(process.env.E2E_H ?? 450) };
const QUALITY = process.env.E2E_QUALITY ?? 'low';
const a = await (await browserA.newContext({ viewport })).newPage();
const b = await (await browserB.newContext({ viewport })).newPage();
for (const [n, p] of [['A', a], ['B', b]]) {
  // Renderização por software (SwiftShader) é lenta: usa qualidade baixa por padrão no teste.
  await p.addInitScript((q) => localStorage.setItem('nullpoint.settings.v1', JSON.stringify({ quality: q, showFps: true })), QUALITY);
  p.setDefaultTimeout(60000);
  p.on('pageerror', (e) => {
    failures++;
    console.error(`[${n}] erro na página:`, e.message);
  });
  p.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.error(`[${n}] console:`, m.text()));
}

try {
  // ---- Menu e criação de sala ----
  await a.goto(URL);
  await a.waitForSelector('.screen-menu.is-on');
  await sleep(600);
  await a.screenshot({ path: `${SHOTS}/01-menu.png` });
  await a.fill('.field--name input', 'Lucas');
  await a.click('button:has-text("CRIAR SALA")');
  await a.waitForSelector('.screen-lobby.is-on .room-code');
  const code = (await a.textContent('.room-code')).trim();
  check(/^[A-Z2-9]{6}$/.test(code), `sala criada com código ${code}`);

  // ---- Segundo navegador entra pelo link de convite ----
  await b.goto(`${URL}/?sala=${code}`);
  await b.waitForSelector('.screen-menu.is-on');
  check((await b.inputValue('.field__input--code')) === code, 'link de convite preenche o código');
  await b.fill('.field--name input', 'Amigo');
  await b.click('button:has-text("ENTRAR")');
  await b.waitForSelector('.screen-lobby.is-on');
  await a.waitForFunction(() => document.querySelectorAll('.slot:not(.slot--empty)').length === 2);
  check(true, 'lobby do anfitrião mostra os 2 jogadores');
  check((await b.textContent('.lobby__foot')).includes('Aguardando o anfitrião'), 'convidado não pode iniciar');
  await sleep(300);
  await a.screenshot({ path: `${SHOTS}/02-lobby.png` });

  // ---- Início da partida ----
  await a.click('button:has-text("INICIAR PARTIDA")');
  await Promise.all([a.waitForSelector('.screen-game.is-on'), b.waitForSelector('.screen-game.is-on')]);
  check(true, 'partida iniciada nos dois navegadores');
  await sleep(1500);
  await a.screenshot({ path: `${SHOTS}/03-pause.png` });

  check(await a.isVisible('button:has-text("CLIQUE PARA JOGAR")'), 'tela "clique para jogar" exibida');

  // Acesso ao estado do jogo para medir (somente leitura, exceto mira e captura do ponteiro).
  const gameState = (p) =>
    p.evaluate(() => {
      const g = window.nullpoint.game;
      const me = g.predictor.state.pos;
      const remotes = [...g.remotes.values()].map((r) => ({ id: r.id, alive: r.alive, s: r.state }));
      return { me: { ...me }, alive: g.alive, remotes, hp: g.hp, rtt: g.net.rtt };
    });

  // O Chrome headless não concede pointer lock: o teste marca o input como capturado e fecha a sobreposição.
  for (const p of [a, b]) {
    await p.evaluate(() => {
      const g = window.nullpoint.game;
      if (!document.pointerLockElement) {
        g.input.locked = true;
        document.querySelector('.overlay-pause')?.classList.remove('is-on');
      }
    });
  }
  await sleep(800);

  const sa0 = await gameState(a);
  const sb0 = await gameState(b);
  check(sa0.alive && sb0.alive, 'os dois jogadores renasceram vivos');
  check(sb0.remotes.some((r) => r.s), 'B recebe snapshots de A');

  // ---- Movimento sincronizado: A anda para frente 1 s ----
  await a.keyboard.down('KeyW');
  await sleep(1000);
  await a.keyboard.up('KeyW');
  // Aguarda o fim da desaceleração e a chegada dos últimos snapshots (renderização por software é lenta).
  await sleep(2000);
  const sa1 = await gameState(a);
  const sb1 = await gameState(b);
  const movedLocal = Math.hypot(sa1.me.x - sa0.me.x, sa1.me.z - sa0.me.z);
  const seenA = sb1.remotes[0]?.s;
  const seenDelta = seenA ? Math.hypot(seenA.x - sa1.me.x, seenA.z - sa1.me.z) : 99;
  check(movedLocal > 1.5, `A se moveu ${movedLocal.toFixed(2)} m (previsão local)`);
  check(seenDelta < 0.15, `B vê A na posição correta (erro ${seenDelta.toFixed(3)} m)`);
  await a.screenshot({ path: `${SHOTS}/04-game-A.png` });
  await b.screenshot({ path: `${SHOTS}/05-game-B.png` });

  // ---- Combate: A mira em B e atira até eliminar ----
  // Os spawns são aleatórios; para ter linha de visão garantida, o teste posiciona os dois jogadores
  // num corredor livre usando um gancho de teste do servidor (ativo só com NULLPOINT_TEST_HOOKS=1).
  await a.evaluate(() => window.nullpoint.net.socket.emit('test:place', { x: -12, z: -22.5 }));
  await b.evaluate(() => window.nullpoint.net.socket.emit('test:place', { x: -3, z: -22.5 }));
  await sleep(2500);
  // A olha para B antes de atirar (captura do modelo do adversário)
  await a.evaluate(() => {
    const g = window.nullpoint.game;
    g.input.yaw = -Math.PI / 2;
    g.input.pitch = -0.02;
  });
  await sleep(1500);
  await a.screenshot({ path: `${SHOTS}/06a-A-ve-B.png` });
  let killed = false;
  for (let attempt = 0; attempt < 40 && !killed; attempt++) {
    const st = await gameState(a);
    const target = st.remotes.find((r) => r.alive && r.s);
    if (!target) {
      await sleep(300);
      continue;
    }
    await a.evaluate(({ t }) => {
      const g = window.nullpoint.game;
      const me = g.predictor.state.pos;
      const eye = { x: me.x, y: me.y + 1.62, z: me.z };
      const dx = t.x - eye.x;
      const dz = t.z - eye.z;
      const dy = t.y + 1.2 - eye.y;
      g.input.yaw = Math.atan2(-dx, -dz);
      g.input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }, { t: target.s });
    await sleep(60);
    await a.mouse.down();
    await sleep(70);
    await a.mouse.up();
    await sleep(160);
    const diag = await a.evaluate(({ t }) => {
      const g = window.nullpoint.game;
      const me = g.predictor.state.pos;
      const eye = { x: me.x, y: me.y + 1.62, z: me.z };
      const d = { x: t.x - eye.x, y: t.y + 1.2 - eye.y, z: t.z - eye.z };
      const len = Math.hypot(d.x, d.y, d.z);
      const hit = g.world.raycast(eye, { x: d.x / len, y: d.y / len, z: d.z / len }, len);
      return { ammo: g.predictor.state.weapon.ammo, dist: len.toFixed(1), blocked: !!hit, me: [me.x.toFixed(1), me.z.toFixed(1)], t: [t.x.toFixed(1), t.z.toFixed(1)] };
    }, { t: target.s });
    if (attempt % 4 === 0) log('tentativa', attempt, JSON.stringify(diag));
    killed = await b.evaluate(() => [...document.querySelectorAll('.feed-row')].some((r) => r.textContent.includes('Lucas')));
  }
  check(killed, 'A eliminou B (validado pelo servidor, feed no navegador de B)');
  await sleep(300);
  await b.screenshot({ path: `${SHOTS}/06-B-eliminado.png` });
  await a.screenshot({ path: `${SHOTS}/07-A-abate.png` });

  // Placar com TAB
  await a.keyboard.down('Tab');
  await sleep(200);
  await a.screenshot({ path: `${SHOTS}/08-placar.png` });
  await a.keyboard.up('Tab');

  // ---- Respawn ----
  await sleep(3500);
  const sb2 = await gameState(b);
  check(sb2.alive && sb2.hp === 100, 'B renasceu com 100 de vida');
  log('RTT medido A:', Math.round(sa1.rtt), 'ms');

  // ---- Encerrar partida pelo anfitrião → tela de resultados ----
  await a.evaluate(() => window.nullpoint.net.endMatch());
  await Promise.all([a.waitForSelector('.overlay-results.is-on'), b.waitForSelector('.overlay-results.is-on')]);
  check(true, 'tela de resultados nos dois navegadores');
  await sleep(500);
  await a.screenshot({ path: `${SHOTS}/09-resultados.png` });
} catch (e) {
  failures++;
  console.error('[e2e] falha:', e);
  await a.screenshot({ path: `${SHOTS}/erro-A.png` }).catch(() => {});
  await b.screenshot({ path: `${SHOTS}/erro-B.png` }).catch(() => {});
} finally {
  await browserA.close();
  await browserB.close();
  server.kill();
}

if (failures) {
  console.error(`[e2e] ${failures} falha(s)`);
  process.exit(1);
}
log('todos os passos passaram');
