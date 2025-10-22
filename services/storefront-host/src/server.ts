import http from 'http';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';

const app = createApp();
const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  console.log(`[storefront-host] listening on http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  console.error('[storefront-host] failed to start:', err.message);
  process.exit(1);
});

const shutdown = () => {
  console.log('[storefront-host] shutting down…');
  server.close(() => {
    console.log('[storefront-host] closed.');
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
