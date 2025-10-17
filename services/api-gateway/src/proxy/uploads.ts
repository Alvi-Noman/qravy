/**
 * @file Uploads proxy
 * Forwards uploads to the upload-service and supports both:
 *   - /api/uploads/*
 *   - /api/v1/upload/*   (legacy)
 */
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Application, Request, Response } from 'express';

export default function registerUploadsProxy(app: Application): void {
  const target = process.env.UPLOAD_SERVICE_URL || 'http://upload-service:4010';
  const svcToken = process.env.UPLOAD_SERVICE_TOKEN || '';

  app.use(
    ['/api/uploads', '/api/v1/upload'],
    // Fast path for CORS preflight
    (req, res, next) => {
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    },
    createProxyMiddleware({
      target,
      changeOrigin: true,
      xfwd: true,
      logLevel: 'debug',

      // Increase timeouts for larger files or slow networks
      timeout: 5 * 60 * 1000,
      proxyTimeout: 5 * 60 * 1000,

      // Strip whichever prefix matched so target sees clean routes:
      //   /api/uploads/images       -> /images
      //   /api/v1/upload/images     -> /images
      pathRewrite: (path) =>
        path
          .replace(/^\/api\/uploads/, '')
          .replace(/^\/api\/v1\/upload/, ''),

      onProxyReq: (proxyReq, req: Request) => {
        // Forward end-user auth if you want the upload-service to know the user
        const userAuth = req.headers.authorization;
        if (typeof userAuth === 'string' && userAuth) {
          proxyReq.setHeader('x-user-authorization', userAuth);
        }
        // Service-to-service token (expected by upload-service)
        if (svcToken) {
          proxyReq.setHeader('authorization', `Bearer ${svcToken}`);
        }
      },

      onError: (err, _req, res: Response) => {
        const code = (err as any).code || 'PROXY_ERROR';
        // eslint-disable-next-line no-console
        console.error('[UPLOAD PROXY ERROR]', err);
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upload gateway error', code }));
      }
    })
  );
}
