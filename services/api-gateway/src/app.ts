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

// Proxy to Auth Service
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

// Proxy to Activity Feed Service
app.use(
  '/api/activities',
  createProxyMiddleware({
    target: process.env.ACTIVITY_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/activities': '/api/activities' }
  })
);

// Proxy to Report Service
app.use(
  '/api/reports',
  createProxyMiddleware({
    target: process.env.REPORT_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/reports': '/api/reports' }
  })
);

// Proxy to Integration Service
app.use(
  '/api/integrations',
  createProxyMiddleware({
    target: process.env.INTEGRATION_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/integrations': '/api/integrations' }
  })
);

// Proxy to Attribution Service
app.use(
  '/api/attribution',
  createProxyMiddleware({
    target: process.env.ATTRIBUTION_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/attribution': '/api/attribution' }
  })
);

// Health check endpoint for monitoring
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

export default app;