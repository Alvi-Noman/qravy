import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js';

type KnownError = {
  status?: number;
  message?: string;
  stack?: string;
};

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  void next;

  const isProd = process.env.NODE_ENV === 'production';

  const known = toKnownError(err);
  const status = known.status ?? 500;
  const message = known.message ?? 'Internal server error';
  const stack = known.stack;

  logger.error(`[ERROR] ${req.method} ${req.originalUrl} - ${message}`);

  // Set CORS headers for error responses
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,authorization');

  if (typeof res.fail === 'function') {
    res.fail(status, message, isProd ? undefined : stack);
    return;
  }

  const body: Record<string, unknown> = {
    success: false,
    message,
    ...(isProd ? {} : { error: stack }),
  };
  res.status(status).json(body);
}

function toKnownError(err: unknown): KnownError {
  const obj = err as Partial<Record<'status' | 'message' | 'stack', unknown>>;

  const status = typeof obj.status === 'number' ? obj.status : undefined;
  const message = typeof obj.message === 'string' ? obj.message : undefined;
  const stack = typeof obj.stack === 'string' ? obj.stack : undefined;

  return { status, message, stack };
}