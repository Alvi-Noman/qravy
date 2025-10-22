/**
 * API Gateway
 */
import 'dotenv/config';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ClientRequest, IncomingMessage } from 'http';
import logger from './utils/logger.js';
import registerUploadsProxy from './proxy/uploads.js';

type NodeErr = Error & { code?: string };

const app: Application = express();

app.set('trust proxy', 1);
app.set('etag', false);

// ── Health FIRST so nothing can swallow it ─────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => res.status(200).json({ status: 'ok' }));

// Basic request log
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.http(`[API Gateway] ${req.method} ${req.originalUrl}`);
  next();
});

/* ───────────────────────────── CORS (allow-list + wildcard) ───────────────────────────── */
// Comma-separated exact origins.
// Default covers your current dev: Vite on 3007 and storefront-host on 8090 (http/https).
const RAW_ORIGINS = (process.env.CORS_ORIGIN ||
  'http://localhost:3007,https://localhost:3007,http://localhost:8090,https://localhost:8090')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true; // SSR/tools/no Origin -> allow

  if (RAW_ORIGINS.includes(origin)) return true;

  try {
    const url = new URL(origin);
    const { protocol, hostname, port } = url;

    const prodRoots = ['qravy.com', 'onqravy.com'];
    if (
      protocol === 'https:' &&
      prodRoots.some((root) => hostname === root || hostname.endsWith(`.${root}`))
    ) {
      return true;
    }

    // Dev allowances for localhost/lvh.me
    const devPorts = new Set([
      '3000',
      '3001',
      '3007', // <-- Vite (current)
      '5173',
      '5174',
      '5179', // <-- alternative Vite we tried
      '8090', // <-- storefront-host
      '', // some browsers omit explicit port for defaults
      null as any,
      undefined as any,
    ]);

    const isDevPort = devPorts.has(port as any);

    if ((hostname === 'localhost' || hostname === '127.0.0.1') && isDevPort) return true;

    if (hostname === 'lvh.me' || hostname.endsWith('.lvh.me')) {
      if (isDevPort) return true;
    }
  } catch {
    // malformed Origin
  }
  return false;
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    logger.warn(`[GATEWAY CORS] blocked origin: ${origin}`);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['ETag'],
  maxAge: 86400,
  optionsSuccessStatus: 204,
};

// CORS before any proxies/body-parsers
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* >>> MOUNT UPLOADS PROXY BEFORE BODY PARSERS <<< */
registerUploadsProxy(app);

// Parse JSON bodies for normal API routes
app.use(express.json({ limit: '2mb' }));

// Targets from .env
const AUTH_TARGET = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
logger.info(`[GATEWAY] AUTH_SERVICE_URL=${AUTH_TARGET}`);

/**
 * Helper: proxy to auth-service with JSON body forwarding
 * - Query strings are automatically preserved by http-proxy-middleware
 */
function jsonProxyToAuth() {
  return createProxyMiddleware({
    target: AUTH_TARGET,
    changeOrigin: true,
    xfwd: true,
    ws: false,

    onProxyReq: (proxyReq: ClientRequest, req: Request & { body?: unknown }) => {
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
}

/**
 * Public proxy: forward /api/v1/public/* as-is to auth-service
 * (No path rewrite; auth-service expects /api/v1/public/*)
 */
function publicProxyToAuth() {
  return createProxyMiddleware({
    target: AUTH_TARGET,
    changeOrigin: true,
    xfwd: true,
    ws: false,

    onProxyReq: (proxyReq: ClientRequest, req: Request & { body?: unknown }) => {
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
        `[PROXY][PUBLIC] ${req.method} ${req.originalUrl} -> ${AUTH_TARGET} error: ${code} ${err.message}`
      );
      if (!res.headersSent) {
        res.status(502).json({ message: 'Bad gateway (auth-service unavailable)', code });
      }
    },
  });
}

// Explicit mounts to auth-service
app.use('/api/v1/public', publicProxyToAuth());  // forward as-is (no rewrite)
app.use('/api/v1/auth', jsonProxyToAuth());
app.use('/api/v1/locations', jsonProxyToAuth());
app.use('/api/v1/access', jsonProxyToAuth());

// Catch-all for other /api/v1/* (includes non-public)
app.use('/api/v1', jsonProxyToAuth());

// Dev 404 tracer for unhandled API routes (outside /api/v1)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api', (req: Request, res: Response) => {
    logger.warn(`[GATEWAY 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Route not found', path: req.originalUrl });
  });
}

export default app;
