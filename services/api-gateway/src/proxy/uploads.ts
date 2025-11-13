// services/api-gateway/src/proxy/uploads.ts
/**
 * Uploads proxy
 * Client paths supported:
 *   - /api/uploads/*
 *   - /api/v1/uploads/*
 *   - /api/v1/upload/* (legacy singular)
 *
 * Default behavior: STRIP the client prefix so upstream sees root paths.
 *   /api/v1/uploads/health  ->  /health
 *   /api/uploads/files      ->  /files
 *
 * To keep paths AS-IS (rare), set:
 *   UPLOAD_SERVICE_BASE_PATH="__AS_IS__"
 *
 * To remap to a custom base at upstream (e.g. "/uploads"):
 *   UPLOAD_SERVICE_BASE_PATH="/uploads"
 */

import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Application, Request, Response } from 'express';
import type { ClientRequest } from 'http';
import logger from '../utils/logger.js';

type NodeErr = Error & { code?: string };

// base = "__AS_IS__"    -> forward path unchanged
// base = undefined/""    -> default to "/" (rewrite to root)
// base = "/uploads"      -> replace client prefix with "/uploads"
function normBase(p: string | undefined): string | null {
  if (p === '__AS_IS__') return '__AS_IS__';
  if (!p) return '/';
  let s = p.trim();
  if (!s.startsWith('/')) s = '/' + s;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export default function registerUploadsProxy(app: Application): void {
  const target = process.env.UPLOAD_SERVICE_URL || 'http://upload-service:4010';
  const svcToken =
    process.env.UPLOAD_SERVICE_TOKEN || process.env.UPLOAD_TOKEN || '';
  const base = normBase(process.env.UPLOAD_SERVICE_BASE_PATH); // default "/"

  const mounts = ['/api/uploads', '/api/v1/uploads', '/api/v1/upload'];

  logger.info(
    `[GATEWAY] Mount uploads proxy for ${JSON.stringify(
      mounts,
    )} -> ${target} (mode=${
      base === '__AS_IS__' ? 'AS-IS' : `rewrite to base "${base}"`
    })`,
  );

  // Preflight so OPTIONS succeeds
  app.options(mounts, (_req, res) => res.sendStatus(204));

  const uploadsProxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    xfwd: true,
    logLevel: 'debug',
    secure: false, // allow self-signed targets during dev
    proxyTimeout: 5 * 60 * 1000,
    timeout: 5 * 60 * 1000,

    pathRewrite: (path: string, req: Request) => {
      // 1) AS-IS: do not touch the path
      if (base === '__AS_IS__') return path;

      // 2) Rewrite: strip the client prefix and prepend base ("/" by default)
      //    Example:
      //      /api/v1/uploads/health -> /health
      //      /api/uploads/files     -> /files
      for (const m of mounts) {
        if (path.startsWith(m)) {
          const tail = path.slice(m.length); // includes leading "/" (or empty)
          if (!base || base === '/') return tail || '/';
          return `${base}${tail || ''}`;
        }
      }
      // No match → leave unchanged
      return path;
    },

    onProxyReq: (proxyReq: ClientRequest, req: Request) => {
      // Bubble user auth for server-side validation (optional)
      const userAuth = req.headers.authorization;
      if (typeof userAuth === 'string' && userAuth) {
        proxyReq.setHeader('x-user-authorization', userAuth);
      }
      // Service token to guard upload-service (optional)
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
        /* noop */
      }
    },

    onError: (err: NodeErr, req: Request, res: Response) => {
      const code = err.code ?? 'PROXY_ERROR';
      logger.error(
        `[PROXY][UPLOADS] ${req.method} ${req.originalUrl} -> ${target} :: ${code} ${err.message}`,
      );
      if (!res.headersSent) {
        res.status(502).json({ error: 'Upload gateway error', code });
      }
    },
  });

  // Mount once for the array of prefixes
  app.use(mounts, uploadsProxy);
}
