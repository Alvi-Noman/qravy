// apps/rider/vite.config.ts — the rider app's dev server (port 5610); /api goes to the API gateway (as in production,
// where Caddy sends rider.qravy.com/api/* to it — same address, no CORS).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_PORT = Number(process.env.RIDER_DEV_PORT || process.env.PORT || 5610);
const BIND_HOST = process.env.VITE_BIND_HOST || '127.0.0.1';
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    host: BIND_HOST,
    port: DEV_PORT,
    strictPort: true,
    proxy: { '/api': { target: API_PROXY_TARGET, changeOrigin: true } },
  },
});
