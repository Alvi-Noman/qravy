import express, { Application } from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app: Application = express();

  app.use((req, res, next) => {
    console.log(`[API Gateway] ${req.method} ${req.url}`);
    next();
  });

app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(
  '/api/auth',
  createProxyMiddleware({
    target: 'http://localhost:3001',
    changeOrigin: true,
    pathRewrite: (path, req) => '/api/auth' + path.replace(/^\/api\/auth/, ''),
  })
);

app.use(
  '/api/activities',
  createProxyMiddleware({
    target: 'http://localhost:3002',
    changeOrigin: true,
    pathRewrite: { '^/api/activities': '/api/activities' }
  })
);

app.use(
  '/api/reports',
  createProxyMiddleware({
    target: 'http://localhost:3003',
    changeOrigin: true,
    pathRewrite: { '^/api/reports': '/api/reports' }
  })
);

app.use(
  '/api/integrations',
  createProxyMiddleware({
    target: 'http://localhost:3004',
    changeOrigin: true,
    pathRewrite: { '^/api/integrations': '/api/integrations' }
  })
);

app.use(
  '/api/attribution',
  createProxyMiddleware({
    target: 'http://localhost:3005',
    changeOrigin: true,
    pathRewrite: { '^/api/attribution': '/api/attribution' }
  })
);

export default app;