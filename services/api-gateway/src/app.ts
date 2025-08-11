import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { IncomingMessage, ServerResponse } from 'http';
import logger from './utils/logger.js';
import morgan from 'morgan';

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

const app: Application = express();

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

app.use(morgan('combined', {
  stream: {
    write: (message: string) => logger.http(message.trim())
  }
}));

// Proxy to Auth Service ONLY, with logging
if (process.env.AUTH_SERVICE_URL) {
  app.use(
    '/api/v1/auth',
    createProxyMiddleware({
      target: process.env.AUTH_SERVICE_URL,
      changeOrigin: true,
      pathRewrite: (path: string, req: IncomingMessage) =>
        '/api/v1/auth' + path.replace(/^\/api\/v1\/auth/, ''),
      cookieDomainRewrite: "localhost",
      onProxyReq: (proxyReq: any, req: IncomingMessage, res: ServerResponse) => {
        console.log(`[API-GATEWAY] Proxying ${req.method} ${req.url} to ${process.env.AUTH_SERVICE_URL}`);
      },
      onError: (err: any, req: IncomingMessage, res: ServerResponse) => {
        console.error('[API-GATEWAY] Proxy error:', err);
        if (res.writeHead) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ message: 'Proxy error', error: (err as Error).message }));
      }
    } as any) // 
  );
}

// Health check endpoint for monitoring
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

export default app;