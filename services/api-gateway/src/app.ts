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

// Auth-service proxy: forwards /api/v1/auth/* to auth-service
app.use(
  '/api/v1/auth',
  createProxyMiddleware({
    target: AUTH_TARGET,
    changeOrigin: true,
    xfwd: true,
    ws: false,
    cookieDomainRewrite: 'localhost',
    onProxyReq: (proxyReq: ClientRequest, req: Request & { body?: unknown }) => {
      // Forward JSON body (only for methods that can have a body)
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
  })
);

// Uploads proxy (your existing module)
registerUploadsProxy(app);

// Health
app.get('/health', (_req: Request, res: Response) => res.status(200).json({ status: 'ok' }));

// Dev 404 tracer for unhandled API routes
if (process.env.NODE_ENV !== 'production') {
  app.use('/api', (req: Request, res: Response) => {
    logger.warn(`[GATEWAY 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Route not found', path: req.originalUrl });
  });
}

export default app;