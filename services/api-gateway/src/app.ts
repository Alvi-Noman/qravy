import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import logger from './utils/logger.js'; // Use your shared Winston logger

const app: Application = express();

// Log every request for debugging and monitoring
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.http(`[API Gateway] ${req.method} ${req.url}`);
  next();
});

// CORS setup for frontend dev/prod flexibility
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Proxy to Auth Service ONLY
if (process.env.AUTH_SERVICE_URL) {
  app.use(
    '/api/v1/auth',
    createProxyMiddleware({
      target: process.env.AUTH_SERVICE_URL,
      changeOrigin: true,
      pathRewrite: (path: string, req: Request) =>
        '/api/v1/auth' + path.replace(/^\/api\/v1\/auth/, ''),
      cookieDomainRewrite: "localhost",
    })
  );
}

// Health check endpoint for monitoring
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

export default app;