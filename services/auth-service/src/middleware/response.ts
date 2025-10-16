import type { Request, Response, NextFunction } from 'express';

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Response {
      ok: (data?: Record<string, unknown>, status?: number) => import('express').Response;
      fail: (status: number, message: string, extra?: unknown) => import('express').Response;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

export function responseFormatter(_req: Request, res: Response, next: NextFunction): void {
  res.ok = (data: Record<string, unknown> = {}, status = 200) => {
    return res.status(status).json({ success: true, ...data });
  };

  res.fail = (status: number, message: string, extra?: unknown) => {
    const body: Record<string, unknown> = { success: false, message };
    if (typeof extra !== 'undefined') body.error = extra;
    return res.status(status).json(body);
  };

  next();
}