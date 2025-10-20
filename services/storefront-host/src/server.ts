import http from 'http';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 8090);
const app = createApp();
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`[storefront-host] listening on http://localhost:${PORT}`);
});
