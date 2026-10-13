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
  sessionType?: 'member' | 'branch'; // 👈 pass-through for scope.ts
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

  // Check both collections
  const memberships = db.collection<MembershipDoc>('memberships');
  const members = db.collection<MembershipDoc>('members');

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
    const query = { tenantId: tid, userId: new ObjectId(userId), status: 'active' } as const;

    let m =
      (await memberships.findOne(query)) ||
      (await members.findOne(query));

    if (m) {
      activeTenantId = tid;
      role = m.role;
      break;
    }
  }

  return { tenantId: activeTenantId?.toHexString(), role };
}

/**
 * The branch this session is locked to, if any — then it sees and runs that branch only (orders, table calls, the
 * buzzer, its menu's on/off switches), never the restaurant's setup:
 *  - a staff member limited to one branch (Settings → Team: "<branch> only"), or
 *  - a device assigned to a branch (sign-in → "Which location are you signing from?", Settings → Restaurant Access).
 * The owner's and admins' own devices aren't assigned, so they keep every branch.
 */
export async function lockedBranch(req: Request, tenantId?: string, userId?: string): Promise<string | null> {
  if (!tenantId || !ObjectId.isValid(tenantId)) return null;
  const tenantOid = new ObjectId(tenantId);
  const db = client.db('authDB');
  try {
    if (userId && ObjectId.isValid(userId)) {
      const m = await db
        .collection<MembershipDoc>('memberships')
        .findOne(
          { tenantId: tenantOid, userId: new ObjectId(userId), status: 'active', locationId: { $type: 'objectId' } },
          { projection: { locationId: 1 } }
        );
      if (m?.locationId) return (m.locationId as ObjectId).toHexString();
    }
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const deviceKey = (cookies?.deviceKey || '').trim();
    if (deviceKey) {
      const dev = await db
        .collection<DeviceDoc>('devices')
        .findOne({ tenantId: tenantOid, deviceKey, status: 'active' }, { projection: { locationId: 1 } });
      if (dev?.locationId) return (dev.locationId as ObjectId).toHexString();
    }
  } catch {
    // a lookup failure must not lock anyone out — the token's own scope still applies
  }
  return null;
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

    const payload = decoded as JwtUserPayload;
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
    const { tenantId: resolvedTenantId, role: resolvedRole } = await resolveTenantAndRole(
      id,
      headerTenantId || tokenTenantId
    );

    const finalTenantId = resolvedTenantId || tokenTenantId || headerTenantId;

    // Role/sessionType from token should win (admins/owners set at login/refresh)
    const roleFromToken = payload.role;
    const sessionTypeFromToken = payload.sessionType;

    // a branch staff member, or a device assigned to a branch → this session is that branch's (whatever the role);
    // a token issued on such a device carries the lock too (the AI waiter checks staff with the token alone)
    const lock =
      (await lockedBranch(req, finalTenantId, id)) ??
      (payload.sessionType === 'branch' && typeof payload.locationId === 'string' ? payload.locationId : null);

    req.user = {
      ...(payload as any),
      id,
      email,
      tenantId: finalTenantId,
      role: roleFromToken ?? resolvedRole,     // 👈 prefer token role
      sessionType: lock ? 'branch' : sessionTypeFromToken,
      locationId: lock ?? payload.locationId,
    };
    next();
  } catch {
    logger.warn(`[AUTH] Invalid or expired token for ${req.method} ${req.originalUrl}`);
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export { authenticateJWT as auth };
