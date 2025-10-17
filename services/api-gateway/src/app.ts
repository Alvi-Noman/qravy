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

const app: Application = express();

app.set('trust proxy', 1);
app.set('etag', false);

// Basic request log
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.http(`[API Gateway] ${req.method} ${req.originalUrl}`);
  next();
});

/* ---------- CORS (explicit origins + credentials) ---------- */
// Comma-separated origins, e.g. "https://app.qravy.com,https://localhost:5173"
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'https://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    // Allow REST tools / SSR / same-origin (no Origin header)
    if (!origin) return cb(null, true);
    if (CORS_ORIGINS.includes(origin)) return cb(null, true);

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

// CORS must come BEFORE all proxies
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/**
 * Handle all OPTIONS (preflight) early.
 * This ensures preflights never reach proxy targets.
 */
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

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

    onError(err, req, res) {
      const code = (err as any).code || 'UNKNOWN';
      logger.error(
        `[PROXY][AUTH] ${req.method} ${req.originalUrl} -> ${AUTH_TARGET} error: ${code} ${(err as Error).message}`
      );
      if (!(res as Response).headersSent) {
        (res as Response).status(502).json({ message: 'Bad gateway (auth-service unavailable)', code });
      }
    },
  });
}

// Explicit mounts to auth-service (clear & overridable later)
app.use('/api/v1/auth', jsonProxyToAuth());
app.use('/api/v1/locations', jsonProxyToAuth());
app.use('/api/v1/access', jsonProxyToAuth());

// Catch-all for any other /api/v1/* paths served by auth-service
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
