// apps/braincell/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const DEV_PORT = Number(process.env.BRAINCELL_DEV_PORT || process.env.PORT || 5501)
// Force IPv4 to avoid Windows "::1" bind issues
const HOST: string = '127.0.0.1'
// In Docker, bind all interfaces so the published port is reachable
const BIND_HOST: string = process.env.VITE_BIND_HOST || HOST
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:8080'
// Bind-mounted Windows folders don't emit fs events inside containers
const usePolling = process.env.VITE_USE_POLLING === 'true'

export default defineConfig({
  plugins: [react()],
  server: {
    host: BIND_HOST,
    port: DEV_PORT,
    strictPort: true,
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
    cors: true,
    hmr: {
      host: HOST,             // keep same host for HMR
      port: DEV_PORT,
      protocol: 'ws',
    },
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
})
