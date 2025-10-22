import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_PORT = Number(process.env.VITE_DEV_PORT ?? process.env.PORT ?? 3007);

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // 0.0.0.0 so Docker/container can reach it
    port: DEV_PORT,
    strictPort: true,
    cors: true,
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'host.docker.internal', // allow storefront-host proxy
    ],
    hmr: {
      host: 'localhost',
      port: DEV_PORT,
      protocol: 'ws',
    },
  },
});
