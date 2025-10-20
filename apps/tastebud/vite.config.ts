// apps/tastebud/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,   // allow subdomain testing like pizza.lvh.me
    port: 5174,   // force 5174
  },
});
