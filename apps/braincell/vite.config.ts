// apps/braincell/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Resolve certs from repo root: ./certs/*
const keyPath  = path.resolve(__dirname, '../../certs/localhost-key.pem')
const certPath = path.resolve(__dirname, '../../certs/localhost.pem')

function getHttpsOptions():
  | { key: Buffer; cert: Buffer }
  | undefined {
  const hasKey  = fs.existsSync(keyPath)
  const hasCert = fs.existsSync(certPath)
  if (hasKey && hasCert) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
  }
  return undefined
}

const DEV_PORT = Number(process.env.BRAINCELL_DEV_PORT || process.env.PORT || 5501)
// Force IPv4 to avoid Windows "::1" bind issues
const HOST: string = '127.0.0.1'

// Only enable HTTPS when host is 'localhost' (so the cert CN matches).
// When HOST is 127.0.0.1, force HTTP.
const httpsOptions = HOST === 'localhost' ? getHttpsOptions() : undefined
const isHttps = Boolean(httpsOptions)

export default defineConfig({
  plugins: [react()],
  server: {
    host: HOST,
    port: DEV_PORT,
    strictPort: true,
    https: httpsOptions,       // 127.0.0.1 => HTTP; localhost => HTTPS if certs exist
    cors: true,
    hmr: {
      host: HOST,             // keep same host for HMR
      port: DEV_PORT,
      protocol: isHttps ? 'wss' : 'ws',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
