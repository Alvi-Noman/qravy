import type { Request, Response, NextFunction } from 'express';

// Augment Express.Response with ok/fail helpers
declare global {
  namespace Express {
    interface Response {
      ok: (data?: any, status?: number) => Response;
      fail: (status: number, message: string, extra?: any) => Response;
    }
  }
}

export function responseFormatter(_req: Request, res: Response, next: NextFunction) {
  res.ok = (data: any = {}, status = 200) => {
    // Keep original keys intact (e.g., { items }, { item }) and add success
    return res.status(status).json({ success: true, ...data });
  };

  res.fail = (status: number, message: string, extra?: any) => {
    // Preserve top-level "message" for existing clients and add success=false
    // Optional "error" details included for diagnostics (ignored by current FE)
    const body: any = { success: false, message };
    if (extra !== undefined) body.error = extra;
    return res.status(status).json(body);
  };

  next();
}