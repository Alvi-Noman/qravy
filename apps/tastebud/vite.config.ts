import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const DEV_PORT = Number(process.env.VITE_DEV_PORT || process.env.PORT || 3007)

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // switch to '127.0.0.1' if your firewall blocks 0.0.0.0
    port: DEV_PORT,
    strictPort: true,    // don't silently try other ports
    cors: true,
    hmr: {
      host: 'localhost', // ok for local dev; if you reverse-proxy, set your host
      port: DEV_PORT,    // <<< THIS stops Vite from trying 5173 for HMR
      protocol: 'ws',
    },
  },
})
