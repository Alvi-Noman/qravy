/**
 * API Gateway
 */
import 'dotenv/config';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ClientRequest } from 'http';
import logger from './utils/logger.js';
import registerUploadsProxy from './proxy/uploads.js';

const app: Application = express();

app.set('trust proxy', 1);

// Basic request log
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.http(`[API Gateway] ${req.method} ${req.originalUrl}`);
  next();
});

// CORS (supports comma-separated origins in CORS_ORIGIN)
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      // allow requests with no origin (curl/mobile apps)
      if (!origin) return cb(null, true);
      if (CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'authorization'],
  })
);

// Parse JSON bodies (we re-forward body on proxy below)
app.use(express.json({ limit: '2mb' }));

// Targets from .env
const AUTH_TARGET = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';

// Helper: proxy with JSON body forwarding and basic error logging
const jsonProxyToAuth = () =>
  createProxyMiddleware({
    target: AUTH_TARGET,
    changeOrigin: true,
    xfwd: true,
    ws: false,
    cookieDomainRewrite: 'localhost',
    onProxyReq: (proxyReq: ClientRequest, req: Request & { body?: unknown }) => {
      // Forward JSON body for methods that can have a body
      const method = (req.method || 'GET').toUpperCase();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
      if (!req.body || !Object.keys(req.body as object).length) return;

      const contentType = (proxyReq.getHeader('content-type') as string | undefined) || '';
      if (!contentType.includes('application/json')) return;

      const body = JSON.stringify(req.body);
      proxyReq.setHeader('content-length', Buffer.byteLength(body));
      proxyReq.write(body);
    },
    onError(err, req, res) {
      logger.error(
        `[PROXY][AUTH] ${req.method} ${req.originalUrl} -> ${AUTH_TARGET} error: ${(err as Error).message}`
      );
      if (!res.headersSent) {
        (res as Response).status(502).json({ message: 'Bad gateway (auth-service unavailable)' });
      }
    },
  });

// Uploads proxy (mount this BEFORE the catch-all /api/v1 proxy)
registerUploadsProxy(app);

// Proxies to auth-service
// 1) Explicit important paths
app.use('/api/v1/auth', jsonProxyToAuth());
app.use('/api/v1/locations', jsonProxyToAuth());

// 2) Catch-all for any other /api/v1/* endpoints served by auth-service
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