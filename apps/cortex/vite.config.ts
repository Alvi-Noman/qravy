// apps/cortex/vite.config.ts — Cortex dev server (port 5600); /api goes to the API gateway.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_PORT = Number(process.env.CORTEX_DEV_PORT || process.env.PORT || 5600);
const BIND_HOST = process.env.VITE_BIND_HOST || '127.0.0.1';
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:8080';
const usePolling = process.env.VITE_USE_POLLING === 'true';

export default defineConfig({
  plugins: [react()],
  server: {
    host: BIND_HOST,
    port: DEV_PORT,
    strictPort: true,
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
    hmr: { host: '127.0.0.1', port: DEV_PORT, protocol: 'ws' },
    proxy: { '/api': { target: API_PROXY_TARGET, changeOrigin: true } },
  },
});
