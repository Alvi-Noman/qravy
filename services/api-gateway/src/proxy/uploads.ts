// services/api-gateway/src/proxy/uploads.ts
/**
 * Uploads proxy
 * Supports client paths:
 *   - /api/uploads/*          (recommended)
 *   - /api/v1/uploads/*       (canonical)
 *   - /api/v1/upload/*        (legacy singular)
 *
 * By default we forward the path AS-IS to the upload-service.
 * If you need to remap, set UPLOAD_SERVICE_BASE_PATH to a prefix like:
 *   "" (empty)         -> keep original path (default)
 *   "/uploads"         -> replace the matched client prefix with "/uploads"
 *   "/api/uploads"     -> replace with this exact base
 */
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Application, Request, Response } from 'express';
import type { ClientRequest } from 'http';
import logger from '../utils/logger.js';

type NodeErr = Error & { code?: string };

function normBase(p: string | undefined): string {
  if (!p) return '';
  let s = p.trim();
  if (!s.startsWith('/')) s = '/' + s;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export default function registerUploadsProxy(app: Application): void {
  const target = process.env.UPLOAD_SERVICE_URL || 'http://upload-service:4010';
  const svcToken =
    process.env.UPLOAD_SERVICE_TOKEN || process.env.UPLOAD_TOKEN || '';
  const base = normBase(process.env.UPLOAD_SERVICE_BASE_PATH);

  logger.info(
    `[GATEWAY] Mount uploads proxy for [/api/uploads, /api/v1/uploads, /api/v1/upload] -> ${target} (base=${base || '<as-is>'})`
  );

  // Match all three prefixes
  const mounts = ['/api/uploads', '/api/v1/uploads', '/api/v1/upload'];

  // Normalize path according to optional base. If base is empty, keep the original path.
  const rewrite = (path: string) => {
    if (!base) return path; // forward as-is (most compatible)
    // Replace only the first matching mount with the configured base
    for (const m of mounts) {
      if (path.startsWith(m)) {
        const tail = path.slice(m.length); // includes leading "/" of the remainder
        return `${base}${tail}`;
      }
    }
    return path; // fallback: unchanged
  };

  // Preflight helper so OPTIONS succeeds
  app.options(mounts, (_req, res) => res.sendStatus(204));

  app.use(
    mounts,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      xfwd: true,
      logLevel: 'debug',
      secure: false, // allow self-signed in dev if target uses https
      proxyTimeout: 5 * 60 * 1000,
      timeout: 5 * 60 * 1000,

      pathRewrite: rewrite,

      onProxyReq: (proxyReq: ClientRequest, req: Request) => {
        // Bubble end-user auth if present (optional)
        const userAuth = req.headers.authorization;
        if (typeof userAuth === 'string' && userAuth) {
          proxyReq.setHeader('x-user-authorization', userAuth);
        }
        // Service token for upload-service (both header shapes)
        if (svcToken) {
          proxyReq.setHeader('authorization', `Bearer ${svcToken}`);
          proxyReq.setHeader('x-upload-token', svcToken);
        }
      },

      onProxyRes: (_proxyRes, _req, res) => {
        try {
          res.removeHeader('ETag');
          res.setHeader('Cache-Control', 'no-store');
        } catch {
          /* no-op */
        }
      },

      onError: (err: NodeErr, req: Request, res: Response) => {
        const code = err.code ?? 'PROXY_ERROR';
        logger.error(
          `[UPLOAD PROXY ERROR] ${req.method} ${req.originalUrl} -> ${target} ${code} ${err.message}`
        );
        if (!res.headersSent) {
          res.status(502).json({ error: 'Upload gateway error', code });
        }
      },
    })
  );
}
