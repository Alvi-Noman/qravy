import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const message = err.message || 'Internal server error';

  // Log with request context
  logger.error(`[ERROR] ${req.method} ${req.originalUrl} - ${message}`);

  // Set CORS headers for error responses
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,authorization');

  // Prefer centralized formatter; keep top-level "message" for existing clients
  const body: any = {
    success: false,
    message,
    ...(isProd ? {} : { stack: err.stack }),
  };

  if (typeof res.fail === 'function') {
    return res.fail(status, message, isProd ? undefined : err.stack);
  }

  return res.status(status).json(body);
}