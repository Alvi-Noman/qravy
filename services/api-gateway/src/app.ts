/**
 * API Gateway
 * - Always proxy /api/v1/auth (fallback to http://auth-service:3001)
 * - CORS
 * - Health
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { config as loadEnv } from 'dotenv';
import logger from './utils/logger.js';
import type { IncomingMessage } from 'http';

loadEnv(); // load .env if present (dev)

const app: Application = express();

/** Log */
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.http(`[API Gateway] ${req.method} ${req.url}`);
  next();
});

/** CORS (allow common methods) */
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'authorization'],
  })
);
// Answer preflight explicitly
app.options('*', cors());

/** Proxy /api/v1/auth to auth-service with a safe default target */
const AUTH_TARGET = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
logger.info(`[API Gateway] Proxy target for /api/v1/auth => ${AUTH_TARGET}`);

app.use(
  '/api/v1/auth',
  createProxyMiddleware({
    target: AUTH_TARGET,
    changeOrigin: true,
    cookieDomainRewrite: 'localhost',
    xfwd: true,
    // Add back the stripped prefix so auth-service receives /api/v1/auth/...
    pathRewrite: (proxyPath: string, _req: IncomingMessage) => `/api/v1/auth${proxyPath}`,
  } as any)
);

/** Health */
app.get('/health', (_req: Request, res: Response) =>
  res.status(200).json({ status: 'ok' })
);

export default app;