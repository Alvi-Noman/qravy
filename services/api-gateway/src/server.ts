import app from './app.js';
import { config } from 'dotenv';
import fs from 'fs';
import http from 'http';
import https from 'https';
import logger from './utils/logger.js';

config();

const PORT = Number(process.env.PORT) || 8080;
const KEY_PATH = process.env.SSL_KEY_PATH;
const CERT_PATH = process.env.SSL_CERT_PATH;

function tryLoadTLS() {
  if (!KEY_PATH || !CERT_PATH) return null;
  try {
    const key = fs.readFileSync(KEY_PATH);
    const cert = fs.readFileSync(CERT_PATH);
    return { key, cert };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`[GATEWAY TLS] Failed to read certs: ${msg}. Falling back to HTTP.`);
    return null;
  }
}

const tls = tryLoadTLS();

const server = tls
  ? https.createServer(tls, app)
  : http.createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  logger.info(
    `API Gateway running on ${tls ? 'HTTPS' : 'HTTP'}://localhost:${PORT} in ${process.env.NODE_ENV || 'development'}`
  );
});

server.on('error', (err) => {
  logger.error('API Gateway failed to start: ' + err.message);
  process.exit(1);
});

const shutdown = () => {
  logger.info('Shutting down API Gateway...');
  server.close(() => {
    logger.info('API Gateway closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
