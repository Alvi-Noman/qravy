import type { Request, Response, NextFunction } from 'express';

export default function verifyUploadToken(req: Request, res: Response, next: NextFunction) {
  const raw = req.get('authorization') || req.get('x-upload-token') || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
  if (!token || token !== process.env.UPLOAD_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}
