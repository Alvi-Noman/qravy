import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_PORT = Number(process.env.VITE_DEV_PORT ?? process.env.PORT ?? 3007);
const VOICE_WS_PROXY_TARGET = process.env.VOICE_WS_PROXY_TARGET ?? 'ws://localhost:7071';
// Bind-mounted Windows folders don't emit fs events inside containers
const usePolling = process.env.VITE_USE_POLLING === 'true';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: DEV_PORT,
    strictPort: true,
    cors: true,
    allowedHosts: ['localhost', '127.0.0.1', 'host.docker.internal', 'tastebud'],
    hmr: { host: 'localhost', port: DEV_PORT, protocol: 'ws' },
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      '/ws/voice': {
        target: VOICE_WS_PROXY_TARGET,
        changeOrigin: true,
        ws: true,
        secure: false,
      },
    },
  },
});
