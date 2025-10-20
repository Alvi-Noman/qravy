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

// Basic request log
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.http(`[API Gateway] ${req.method} ${req.originalUrl}`);
  next();
});

/* ───────────────────────────── CORS (allow-list + wildcard) ───────────────────────────── */
// Comma-separated exact origins, e.g. "https://app.qravy.com,https://localhost:5173"
const RAW_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin?: string): boolean {
  // Allow SSR/tools (no Origin header)
  if (!origin) return true;

  // Exact match first (scheme + host + optional port)
  if (RAW_ORIGINS.includes(origin)) return true;

  // Programmatic wildcard handling
  try {
    const url = new URL(origin);
    const { protocol, hostname, port } = url;

    // ---- Production multi-tenant roots: only HTTPS allowed ----
    const prodRoots = ['qravy.com', 'onqravy.com'];
    if (
      protocol === 'https:' &&
      prodRoots.some((root) => hostname === root || hostname.endsWith(`.${root}`))
    ) {
      return true;
    }

    // ---- Dev convenience: localhost and *.lvh.me allowed over HTTP/HTTPS on common dev ports ----
    const devPorts = new Set(['3000', '3001', '5173', '5174', '', null as any, undefined as any]);
    const isDevPort = devPorts.has(port as any);

    // localhost:<devPort>
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && isDevPort) return true;

    // *.lvh.me:<devPort> (lvh.me resolves to 127.0.0.1, useful for subdomain testing)
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

// IMPORTANT: CORS MUST come before any proxies/body-parsers
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
      // Only forward JSON bodies for mutating methods
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
      // Prevent caching on proxied JSON responses
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

// Explicit mounts to auth-service (clear & overridable later)
app.use('/api/v1/auth', jsonProxyToAuth());
app.use('/api/v1/locations', jsonProxyToAuth());
app.use('/api/v1/access', jsonProxyToAuth());

// Catch-all for any other /api/v1/* paths served by auth-service
// (includes /api/v1/public/**)
app.use('/api/v1', jsonProxyToAuth());

// Health
app.get('/health', (_req: Request, res: Response) => res.status(200).json({ status: 'ok' }));

// Dev 404 tracer for unhandled API routes (outside /api/v1)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api', (req: Request, res: Response) => {
    logger.warn(`[GATEWAY 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Route not found', path: req.originalUrl });
  });
}

export default app;
