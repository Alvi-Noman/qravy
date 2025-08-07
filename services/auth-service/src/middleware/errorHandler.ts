import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js'; // Import your shared logger

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';

  // Log the error with request info for debugging and monitoring
  logger.error(
    `[ERROR] ${req.method} ${req.originalUrl} - ${err.message || 'Internal server error'}`
  );

  res.status(status).json({
    message: err.message || 'Internal server error',
    ...(isProd ? null : { stack: err.stack }),
  });
}