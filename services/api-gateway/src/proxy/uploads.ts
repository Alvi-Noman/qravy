/**
 * @file Uploads proxy
 */
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Application, Request, Response } from 'express';

export default function registerUploadsProxy(app: Application): void {
  const target = process.env.UPLOAD_SERVICE_URL || 'http://upload-service:4010';
  const svcToken = process.env.UPLOAD_SERVICE_TOKEN || '';

  app.use(
    '/api/v1/upload',
    // Handle CORS preflight quickly
    (req, res, next) => {
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    },
    createProxyMiddleware({
      target,
      changeOrigin: true,
      xfwd: true,
      logLevel: 'debug', // Logs all proxy activity

      // Increase timeouts for large uploads
      timeout: 5 * 60 * 1000,       // 5 minutes
      proxyTimeout: 5 * 60 * 1000,  // 5 minutes

      onProxyReq: (proxyReq, req: Request) => {
        // Forward the original user's token
        const userAuth = req.headers.authorization;
        if (typeof userAuth === 'string' && userAuth) {
          proxyReq.setHeader('x-user-authorization', userAuth);
        }

        // Use the service token for upload-service Authorization
        if (svcToken) {
          proxyReq.setHeader('authorization', `Bearer ${svcToken}`);
        }

        // DEBUG: log what headers are being sent upstream
        console.debug('Proxying request with headers:', {
          authorization: proxyReq.getHeader('authorization'),
          'x-user-authorization': proxyReq.getHeader('x-user-authorization')
        });
      },

      onError: (err, _req, res: Response) => {
        const code = (err as any).code || 'PROXY_ERROR';
        console.error('Upload proxy error:', err);
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upload gateway error', code }));
      }
    })
  );
}
