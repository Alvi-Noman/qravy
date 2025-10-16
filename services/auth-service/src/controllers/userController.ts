import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';

/**
 * GET /me
 * Returns the authenticated user plus session info for the frontend.
 * - Relies on `authenticateJWT` to populate req.user from the access token
 * - Relies on `applyScope` to compute and attach `capabilities` (and viewAs/location)
 * Response shape matches the frontend expectation: { user, session }
 */
export async function getMe(req: Request, res: Response, _next: NextFunction) {
  const u = req.user;
  if (!u?.id || !u.email) {
    return res.fail(401, 'Unauthorized');
  }

  // Compute isOnboarded from tenant (if any)
  let isOnboarded = false;
  let tenantId: string | null = u.tenantId ?? null;

  if (tenantId && ObjectId.isValid(tenantId)) {
    const tenant = await client
      .db('authDB')
      .collection('tenants')
      .findOne({ _id: new ObjectId(tenantId) });
    isOnboarded = Boolean(tenant?.onboardingCompleted);
  } else {
    tenantId = null;
  }

  // Map backend session types to the frontend SessionInfo union
  // Frontend expects: { type: 'central' | 'member', locationId? }
  const isBranchSession = (u as any).viewAs === 'branch' || u.sessionType === 'branch';
  const session = isBranchSession
    ? ({ type: 'central', locationId: (u as any).locationId ?? null } as const)
    : ({ type: 'member', locationId: null } as const);

  // User payload the UI needs
  const user = {
    id: u.id,
    email: u.email,
    tenantId,
    isOnboarded,
    // pass through role/sessionType if present on token
    role: (u as any).role as 'owner' | 'admin' | 'editor' | 'viewer' | undefined,
    sessionType: u.sessionType as 'member' | 'branch' | undefined,
    // capabilities computed by applyScope middleware
    capabilities: (u as any).capabilities as string[] | undefined,
  };

  return res.ok({ user, session });
}

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  const userId = req.params.id;

  if (!ObjectId.isValid(userId)) {
    return res.fail(400, 'Invalid user id');
  }

  const db = client.db('authDB');
  const users = db.collection('users');
  const tenants = db.collection('tenants');
  const memberships = db.collection('memberships');
  const menuItems = db.collection('menuItems');
  const categories = db.collection('categories');

  const session = client.startSession();

  try {
    await session.withTransaction(async () => {
      // Find user
      const user = await users.findOne({ _id: new ObjectId(userId) }, { session });
      if (!user) {
        throw new Error('User not found');
      }

      // Find tenants owned by this user
      const ownedTenants = await tenants.find({ ownerId: new ObjectId(userId) }, { session }).toArray();

      for (const tenant of ownedTenants) {
        // Delete related data for each tenant
        await memberships.deleteMany({ tenantId: tenant._id }, { session });
        await menuItems.deleteMany({ tenantId: tenant._id }, { session });
        await categories.deleteMany({ tenantId: tenant._id }, { session });

        // Delete tenant
        await tenants.deleteOne({ _id: tenant._id }, { session });

        logger.info(`Deleted tenant ${tenant._id} belonging to user ${userId}`);
      }

      // Finally delete user
      await users.deleteOne({ _id: new ObjectId(userId) }, { session });
    });

    return res.ok({ message: 'User and related tenants removed.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`deleteUser error: ${msg}`);
    next(err);
  } finally {
    await session.endSession();
  }
}
