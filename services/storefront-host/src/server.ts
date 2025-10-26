// services/storefront-host/src/server.ts
import http from 'http';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';

const app = createApp();
const server = http.createServer(app);

// --- WS upgrade handler for /ws/voice ---
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/ws/voice')) {
    const voiceWsProxy = (app as any).get('voiceWsProxy');
    if (voiceWsProxy?.upgrade) {
      voiceWsProxy.upgrade(req, socket, head);
      return;
    }
  }
  // destroy others if no WS route matches
  socket.destroy();
});

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
