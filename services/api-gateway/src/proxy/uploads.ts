/**
 * @file Uploads proxy (flexible base path)
 * Supports public client paths:
 *   - /api/uploads/*    (recommended)
 *   - /api/v1/upload/*  (legacy)
 *
 * Rewrites to the upload-service with an optional base prefix:
 *   UPLOAD_SERVICE_BASE_PATH =
 *     ""                -> target sees "/images"
 *     "/api/uploads"    -> target sees "/api/uploads/images"
 */
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Application, Request, Response } from 'express';

function normBase(p: string | undefined): string {
  if (!p) return '';
  // ensure leading slash, no trailing slash
  let s = p.trim();
  if (!s.startsWith('/')) s = '/' + s;
  if (s !== '/' && s.endsWith('/')) s = s.slice(0, -1);
  if (s === '/') return ''; // treat bare "/" as empty base
  return s;
}

export default function registerUploadsProxy(app: Application): void {
  const target = process.env.UPLOAD_SERVICE_URL || 'http://upload-service:4010';
  const svcToken = process.env.UPLOAD_SERVICE_TOKEN || '';
  const base = normBase(process.env.UPLOAD_SERVICE_BASE_PATH);

  console.log(
    `[GATEWAY] Mounting uploads proxy: [/api/uploads, /api/v1/upload] -> ${target}${base || ''}`
  );

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
      timeout: 5 * 60 * 1000,
      proxyTimeout: 5 * 60 * 1000,

      // Strip the public prefix and prepend the service base (if any).
      //   /api/uploads/images       ->  (base) + /images
      //   /api/v1/upload/images     ->  (base) + /images
      pathRewrite: (path) => {
        const tail = path
          .replace(/^\/api\/uploads/, '')
          .replace(/^\/api\/v1\/upload/, '');
        return `${base}${tail}`;
      },

      onProxyReq: (proxyReq, req: Request) => {
        // Optional: forward end-user auth (if your upload-service wants to know the user)
        const userAuth = req.headers.authorization;
        if (typeof userAuth === 'string' && userAuth) {
          proxyReq.setHeader('x-user-authorization', userAuth);
        }
        // Service-to-service token (send both header formats)
        if (svcToken) {
          proxyReq.setHeader('authorization', `Bearer ${svcToken}`);
          proxyReq.setHeader('x-upload-token', svcToken);
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
