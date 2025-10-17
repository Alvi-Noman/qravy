// services/api-gateway/src/proxy/access.ts
import { Application, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ClientRequest, IncomingMessage } from 'http';
import logger from '../utils/logger.js';

type NodeErr = Error & { code?: string };

const AUTH_TARGET = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';

export default function registerAccessProxy(app: Application) {
  const jsonProxy = createProxyMiddleware({
    target: AUTH_TARGET,
    changeOrigin: true,
    xfwd: true,
    ws: false,
    cookieDomainRewrite: 'localhost',

    onProxyReq: (proxyReq: ClientRequest, req: Request & { body?: unknown }) => {
      const method = (req.method || 'GET').toUpperCase();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;

      const hasBody = req.body && Object.keys(req.body as object).length > 0;
      if (!hasBody) return;

      const contentType = (proxyReq.getHeader('content-type') as string | undefined) || '';
      if (!contentType.includes('application/json')) return;

      const body = JSON.stringify(req.body);
      proxyReq.setHeader('content-length', Buffer.byteLength(body));
      proxyReq.write(body);
    },

    onProxyRes(_proxyRes: IncomingMessage, _req: Request, res: Response) {
      // Prevent caching for safety (same pattern as auth proxy)
      try {
        res.removeHeader('ETag');
        res.setHeader('Cache-Control', 'no-store');
      } catch {
        /* noop */
      }
    },

    onError(err: NodeErr, req: Request, res: Response) {
      const code = err.code ?? 'UNKNOWN';
      logger.error(
        `[PROXY][ACCESS] ${req.method} ${req.originalUrl} -> ${AUTH_TARGET} error: ${code} ${err.message}`
      );
      if (!res.headersSent) {
        res.status(502).json({ message: 'Bad gateway (auth-service unavailable)', code });
      }
    },
  });

  app.use('/api/v1/access', jsonProxy);
}
