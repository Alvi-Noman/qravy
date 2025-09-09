/**
 * API Gateway
 */
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ClientRequest } from 'http';
import { config as loadEnv } from 'dotenv';
import logger from './utils/logger.js';
import registerUploadsProxy from './proxy/uploads.js';

loadEnv();

const app: Application = express();

app.set('trust proxy', 1);

app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.http(`[API Gateway] ${req.method} ${req.url}`);
  next();
});

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'authorization'],
  })
);

app.use(express.json({ limit: '2mb' }));

const AUTH_TARGET = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';

app.use(
  '/api/v1/auth',
  createProxyMiddleware({
    target: AUTH_TARGET,
    changeOrigin: true,
    xfwd: true,
    cookieDomainRewrite: 'localhost',
    onProxyReq: (proxyReq: ClientRequest, req: Request & { body?: unknown }) => {
      if (!req.body || !Object.keys(req.body as object).length) return;
      const ct = (proxyReq.getHeader('content-type') as string | undefined) || '';
      if (!ct.includes('application/json')) return;
      const body = JSON.stringify(req.body);
      proxyReq.setHeader('content-length', Buffer.byteLength(body));
      proxyReq.write(body);
    },
  })
);

registerUploadsProxy(app);

app.get('/health', (_req: Request, res: Response) => res.status(200).json({ status: 'ok' }));

export default app;