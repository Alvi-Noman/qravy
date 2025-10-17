// services/api-gateway/src/proxy/auth.ts
import { Application, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ClientRequest, IncomingMessage } from 'http';
import logger from '../utils/logger.js';

type NodeErr = Error & { code?: string };

const AUTH_TARGET = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';

export default function registerAuthProxy(app: Application) {
  const jsonProxy = createProxyMiddleware({
    target: AUTH_TARGET,
    changeOrigin: true,
    xfwd: true,
    ws: false,
    // IMPORTANT: do not set cookieDomainRewrite — we want host-only cookies bound to the gateway host
    // cookieDomainRewrite: undefined,

    onProxyReq: (proxyReq: ClientRequest, req: Request & { body?: unknown }) => {
      // Only forward JSON bodies for mutating methods (express.json already parsed it)
      const method = (req.method || 'GET').toUpperCase();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;

      const hasBody = req.body && Object.keys(req.body as object).length > 0;
      if (!hasBody) return;

      const ct = (proxyReq.getHeader('content-type') as string | undefined) || '';
      if (!ct.includes('application/json')) return;

      const body = JSON.stringify(req.body);
      proxyReq.setHeader('content-length', Buffer.byteLength(body));
      proxyReq.write(body);
    },

    onProxyRes(proxyRes: IncomingMessage, _req: Request, res: Response) {
      // Don’t cache proxied responses; preserve Set-Cookie as-is
      try {
        if (proxyRes.headers) {
          delete proxyRes.headers.etag;
          delete proxyRes.headers['last-modified'];
          proxyRes.headers['cache-control'] = 'no-store';
        }
        res.removeHeader('ETag');
        res.setHeader('Cache-Control', 'no-store');
      } catch {
        /* noop */
      }
    },

    onError(err: NodeErr, req: Request, res: Response) {
      const code = err.code ?? 'UNKNOWN';
      logger.error(
        `[PROXY][AUTH] ${req.method} ${req.originalUrl} -> ${AUTH_TARGET} error: ${code} ${err.message}`
      );
      if (!res.headersSent) {
        res.status(502).json({ message: 'Bad gateway (auth-service unavailable)', code });
      }
    },
  });

  // Mount EXACTLY at /api/v1/auth so cookie Path=/api/v1/auth matches requests
  logger.info(`[GATEWAY] Mounting auth proxy at /api/v1/auth -> ${AUTH_TARGET}`);
  app.use('/api/v1/auth', jsonProxy);
}
