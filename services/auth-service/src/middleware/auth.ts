import type { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import type { UserDoc } from '../models/User.js';
import type { MembershipDoc } from '../models/Membership.js';
import logger from '../utils/logger.js';

type JwtUserPayload = JwtPayload & {
  id: string;
  email: string;
  tenantId?: string;
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
};

declare global {
  namespace Express {
    interface Request {
      user?: JwtUserPayload;
    }
  }
}

async function resolveTenantAndRole(userId: string, headerTenantId?: string) {
  const db = client.db('authDB');
  const users = db.collection<UserDoc>('users');
  const memberships = db.collection<MembershipDoc>('memberships');

  let activeTenantId: ObjectId | undefined;
  let role: MembershipDoc['role'] | undefined;

  const user = await users.findOne({ _id: new ObjectId(userId) });

  const tryTenantIds: ObjectId[] = [];
  if (headerTenantId && ObjectId.isValid(headerTenantId)) {
    tryTenantIds.push(new ObjectId(headerTenantId));
  }
  if (user?.tenantId) {
    tryTenantIds.push(user.tenantId);
  }

  for (const tid of tryTenantIds) {
    const m = await memberships.findOne({
      tenantId: tid,
      userId: new ObjectId(userId),
      status: 'active',
    });
    if (m) {
      activeTenantId = tid;
      role = m.role;
      break;
    }
  }

  return { tenantId: activeTenantId?.toHexString(), role };
}

export async function authenticateJWT(req: Request, res: Response, next: NextFunction): Promise<void> {
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

    const headerTenantId = req.header('x-tenant-id') || undefined;
    const { tenantId, role } = await resolveTenantAndRole(id, headerTenantId);

    req.user = { ...payload, id, email, tenantId, role };
    next();
  } catch {
    logger.warn(`[AUTH] Invalid or expired token for ${req.method} ${req.originalUrl}`);
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export { authenticateJWT as auth };