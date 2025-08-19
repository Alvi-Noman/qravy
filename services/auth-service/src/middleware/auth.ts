import type { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import logger from '../utils/logger.js';

type JwtUserPayload = JwtPayload & { id: string; email: string };

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      user?: JwtUserPayload;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

export function authenticateJWT(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn(`[AUTH] No token provided for ${req.method} ${req.originalUrl}`);
    res.status(401).json({ message: 'No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1] ?? '';
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    if (typeof decoded !== 'object' || decoded === null) {
      logger.warn(`[AUTH] Invalid token payload for ${req.method} ${req.originalUrl}`);
      res.status(401).json({ message: 'Invalid or expired token' });
      return;
    }

    const payload = decoded as JwtPayload;
    const id = typeof payload.id === 'string' ? payload.id : undefined;
    const email = typeof payload.email === 'string' ? payload.email : undefined;

    if (!id || !email) {
      logger.warn(`[AUTH] Missing id/email in token for ${req.method} ${req.originalUrl}`);
      res.status(401).json({ message: 'Invalid or expired token' });
      return;
    }

    req.user = { ...payload, id, email };
    next();
  } catch {
    logger.warn(`[AUTH] Invalid or expired token for ${req.method} ${req.originalUrl}`);
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}