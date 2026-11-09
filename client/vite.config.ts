import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const serverPort = Number(process.env.SERVER_PORT ?? 3000);

export default defineConfig({
  resolve: { alias: { '@nullpoint/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  server: {
    port: 5173,
    host: true,
    // Em desenvolvimento, o Vite encaminha o WebSocket para o servidor de jogo.
    proxy: { '/socket.io': { target: `http://localhost:${serverPort}`, ws: true } },
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
});
