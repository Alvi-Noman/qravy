import type { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import type { UserDoc } from '../models/User.js';
import type { MembershipDoc } from '../models/Membership.js';
import type { DeviceDoc } from '../models/Device.js';
import logger from '../utils/logger.js';

type JwtUserPayload = JwtPayload & {
  id: string;
  email: string;
  tenantId?: string;
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
  locationId?: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: JwtUserPayload;
    }
  }
}

async function resolveTenantAndRole(userId: string, hintTenantId?: string) {
  const db = client.db('authDB');
  const users = db.collection<UserDoc>('users');
  const memberships = db.collection<MembershipDoc>('memberships');

  let activeTenantId: ObjectId | undefined;
  let role: MembershipDoc['role'] | undefined;

  const user = await users.findOne({ _id: new ObjectId(userId) });

  const tryTenantIds: ObjectId[] = [];
  if (hintTenantId && ObjectId.isValid(hintTenantId)) {
    tryTenantIds.push(new ObjectId(hintTenantId));
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

    const payload = decoded as JwtPayload & { tenantId?: string };
    const id = typeof payload.id === 'string' ? payload.id : undefined;
    const email = typeof payload.email === 'string' ? payload.email : undefined;

    if (!id || !email) {
      logger.warn(`[AUTH] Missing id/email in token for ${req.method} ${req.originalUrl}`);
      res.status(401).json({ message: 'Invalid or expired token' });
      return;
    }

    // Prefer header override, then token tenantId
    const headerTenantId = (req.header('x-tenant-id') || undefined) as string | undefined;
    const tokenTenantId = typeof payload.tenantId === 'string' ? payload.tenantId : undefined;

    // Try to resolve via membership; if none, keep the tenantId from token/header (central email flow)
    const { tenantId: resolvedTenantId, role } = await resolveTenantAndRole(
      id,
      headerTenantId || tokenTenantId
    );

    const finalTenantId = resolvedTenantId || tokenTenantId || headerTenantId;

    // If this is a central session (no role) and we have a tenant, try to bind device -> location via cookie
    let locationIdFromDevice: string | undefined;
    try {
      const cookies = (req as any).cookies as Record<string, string> | undefined;
      const cookieDeviceKey = (cookies?.deviceKey || '').trim();
      if (!role && finalTenantId && cookieDeviceKey) {
        const db = client.db('authDB');
        const dev = await db
          .collection<DeviceDoc>('devices')
          .findOne({
            tenantId: new ObjectId(finalTenantId),
            deviceKey: cookieDeviceKey,
            status: 'active',
          });
        if (dev?.locationId) {
          locationIdFromDevice = (dev.locationId as ObjectId).toHexString();
        }
      }
    } catch {
      // ignore device lookup errors
    }

    req.user = {
      ...(payload as any),
      id,
      email,
      tenantId: finalTenantId,
      role,
      locationId: locationIdFromDevice,
    };
    next();
  } catch {
    logger.warn(`[AUTH] Invalid or expired token for ${req.method} ${req.originalUrl}`);
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export { authenticateJWT as auth };