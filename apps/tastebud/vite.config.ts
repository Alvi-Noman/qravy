import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_PORT = Number(process.env.VITE_DEV_PORT ?? process.env.PORT ?? 3007);

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: DEV_PORT,
    strictPort: true,
    cors: true,
    allowedHosts: ['localhost', '127.0.0.1', 'host.docker.internal'],
    hmr: { host: 'localhost', port: DEV_PORT, protocol: 'ws' },
    proxy: {
      '/ws/voice': {
        target: 'ws://localhost:7071',
        changeOrigin: true,
        ws: true,
        secure: false,
      },
    },
  },
});
