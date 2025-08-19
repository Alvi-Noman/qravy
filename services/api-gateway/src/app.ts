/**
 * @file API Gateway
 */
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { config as loadEnv } from 'dotenv';
import logger from './utils/logger.js';
import registerUploadsProxy from './proxy/uploads.js';

loadEnv();

const app: Application = express();

app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.http(`[API Gateway] ${req.method} ${req.url}`);
  next();
});

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'authorization']
  })
);
app.options('*', cors());

const AUTH_TARGET = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
logger.info(`[API Gateway] Proxy target for /api/v1/auth => ${AUTH_TARGET}`);

app.use(
  '/api/v1/auth',
  createProxyMiddleware({
    target: AUTH_TARGET,
    changeOrigin: true,
    cookieDomainRewrite: 'localhost',
    xfwd: true,
    onProxyRes: (proxyRes, req, res) => {
      // Explicitly set CORS headers to ensure they’re included
      res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'http://localhost:5173');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,authorization');
    }
  })
);

registerUploadsProxy(app);

app.get('/health', (_req: Request, res: Response) => res.status(200).json({ status: 'ok' }));

export default app;