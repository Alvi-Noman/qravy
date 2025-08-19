import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';

export function validateRequest<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const formatted = parsed.error.format();
      if (typeof res.fail === 'function') {
        res.fail(400, 'Validation failed', formatted);
      } else {
        res.status(400).json({ success: false, message: 'Validation failed', errors: formatted });
      }
      return;
    }

    // Assign validated data back onto req.body (keep typesafe, avoid explicit any)
    (req as unknown as { body: unknown }).body = parsed.data as unknown;
    next();
  };
}