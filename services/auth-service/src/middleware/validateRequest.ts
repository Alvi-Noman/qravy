import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodIssue } from 'zod';
import logger from '../utils/logger.js'; // Import your shared logger

export function validateRequest(schema: ZodSchema<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((issue: ZodIssue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      // Log validation errors with request info for debugging
      logger.warn(
        `[VALIDATION] ${req.method} ${req.originalUrl} - Validation failed: ${JSON.stringify(errors)}`
      );
      return res.status(400).json({ message: 'Validation failed', errors });
    }
    next();
  };
}