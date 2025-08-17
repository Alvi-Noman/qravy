import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodIssue } from 'zod';
import logger from '../utils/logger.js';

export function validateRequest(schema: ZodSchema<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((issue: ZodIssue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      // Log validation errors with request info
      logger.warn(
        `[VALIDATION] ${req.method} ${req.originalUrl} - Validation failed: ${JSON.stringify(errors)}`
      );

      // Use centralized formatter when available; preserve top-level "message"
      if (typeof res.fail === 'function') {
        return res.fail(400, 'Validation failed', errors);
      }
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }
    next();
  };
}