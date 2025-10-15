import { Application } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ClientRequest } from 'http';
import logger from '../utils/logger.js';

const AUTH_TARGET = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';

export default function registerAuthProxy(app: Application) {
  const jsonProxy = createProxyMiddleware({
    target: AUTH_TARGET,
    changeOrigin: true,
    xfwd: true,
    ws: false,
    // cookieDomainRewrite: 'localhost', // only for local dev; disable in prod

    onProxyReq: (proxyReq: ClientRequest, req: any) => {
      const method = (req.method || 'GET').toUpperCase();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
      if (!req.body || !Object.keys(req.body).length) return;

      const contentType = (proxyReq.getHeader('content-type') as string | undefined) || '';
      if (!contentType.includes('application/json')) return;

      const body = JSON.stringify(req.body);
      proxyReq.setHeader('content-length', Buffer.byteLength(body));
      proxyReq.write(body);
    },

    onError(err, req, res) {
      const code = (err as any).code || 'UNKNOWN';
      logger.error(
        `[PROXY][AUTH] ${req.method} ${req.originalUrl} -> ${AUTH_TARGET} error: ${code} ${(err as Error).message}`
      );
      if (!res.headersSent) {
        (res as any).status(502).json({ message: 'Bad gateway (auth-service unavailable)', code });
      }
    },
  });

  app.use('/api/v1/auth', jsonProxy);
}
