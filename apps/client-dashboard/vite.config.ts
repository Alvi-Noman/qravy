// apps/client-dashboard/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// Resolve certs from repo root: ./certs/*
const keyPath  = path.resolve(__dirname, '../../certs/localhost-key.pem');
const certPath = path.resolve(__dirname, '../../certs/localhost.pem');

function getHttpsOptions():
  | { key: Buffer; cert: Buffer }
  | undefined {
  const hasKey  = fs.existsSync(keyPath);
  const hasCert = fs.existsSync(certPath);

  if (hasKey && hasCert) {
    return {
      key:  fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  }

  console.warn(
    `[vite] HTTPS disabled: certs not found at ${keyPath} and/or ${certPath}. ` +
    `Vite will run over HTTP.`
  );
  return undefined; // ✅ not `false`
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    https: getHttpsOptions(), // ✅ undefined or proper options

    // Optional: proxy API requests to your local HTTPS gateway
    proxy: {
      '/api': {
        target: 'https://localhost:8080',
        changeOrigin: true,
        secure: false, // allow self-signed gateway cert
      },
    },
  },
});
