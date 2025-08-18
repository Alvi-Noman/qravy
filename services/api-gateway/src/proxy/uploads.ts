/**
 * @file Uploads proxy
 */
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Application, Request, Response, NextFunction } from 'express';

export default function registerUploadsProxy(app: Application): void {
  const target = process.env.UPLOAD_SERVICE_URL || 'http://upload-service:4010';
  const svcToken = process.env.UPLOAD_SERVICE_TOKEN || '';

  app.use(
    '/api/uploads',
    (req: Request, _res: Response, next: NextFunction) => {
      const userAuth = req.headers.authorization;
      if (typeof userAuth === 'string' && userAuth) {
        req.headers['x-user-authorization'] = userAuth;
      }
      if (svcToken) {
        req.headers.authorization = `Bearer ${svcToken}`;
      }
      next();
    },
    createProxyMiddleware({
      target,
      changeOrigin: true,
      xfwd: true
    })
  );
}