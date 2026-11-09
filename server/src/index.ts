import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { GAME_NAME, PROTOCOL_VERSION, type ClientToServer, type ServerToClient } from '@nullpoint/shared';
import { RoomManager } from './rooms/RoomManager';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg',
  '.ico': 'image/x-icon',
};

function staticHandler(root: string | null) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, game: GAME_NAME, protocol: PROTOCOL_VERSION }));
      return;
    }
    if (!root) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Cliente não compilado. Rode "npm run build" ou use o servidor de desenvolvimento do Vite.');
      return;
    }
    // Normaliza e impede path traversal.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = resolve(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    const ext = extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': file.includes(`${join(root, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(file).pipe(res);
  };
}

export interface StartedServer {
  port: number;
  close(): Promise<void>;
  manager: RoomManager;
}

export async function startServer(port: number, clientDist?: string | null): Promise<StartedServer> {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dist = clientDist !== undefined ? clientDist : resolve(here, '../../client/dist');
  const root = dist && existsSync(join(dist, 'index.html')) ? resolve(dist) : null;

  const http = createServer(staticHandler(root));
  const io = new Server<ClientToServer, ServerToClient>(http, {
    transports: ['websocket'],
    maxHttpBufferSize: 16 * 1024, // nenhuma mensagem legítima do cliente passa disso
    // Tolerante a travamentos curtos do navegador (ex.: compilação de shaders em máquinas lentas).
    pingInterval: 10000,
    pingTimeout: 20000,
    cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined,
  });
  const manager = new RoomManager(io);
  io.on('connection', (socket) => manager.attach(socket));
  manager.start();

  await new Promise<void>((r) => http.listen(port, '0.0.0.0', r));
  const addr = http.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;

  return {
    port: actualPort,
    manager,
    close: () =>
      new Promise<void>((r) => {
        manager.stop();
        io.close(() => r());
      }),
  };
}

// Execução direta: `node dist/index.js` ou `tsx src/index.ts`.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  startServer(port).then((s) => {
    console.log(`[${GAME_NAME}] servidor ouvindo em http://localhost:${s.port}  (protocolo v${PROTOCOL_VERSION})`);
  });
}
