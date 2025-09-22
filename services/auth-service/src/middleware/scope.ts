import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import { computeCapabilities, type SessionType } from '../utils/policy.js';

type MutableUser = {
  id: string;
  email: string;
  tenantId?: string;
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
  locationId?: string;
  sessionType?: SessionType; // 'member' | 'branch'
  viewAs?: SessionType; // optional override from header
  capabilities?: string[];
};

/**
 * Apply location scoping and compute capabilities.
 * - Branch (central) sessions must have a device-assigned locationId.
 * - Member sessions can "view-as branch" with headers:
 *     x-view-as: branch
 *     x-location-id: <locationId>
 *   If set, we validate the location belongs to the tenant and restrict capabilities accordingly.
 */
export async function applyScope(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.user as MutableUser | undefined;
  if (!user || !user.id) {
    (res as any).fail ? (res as any).fail(401, 'Unauthorized') : res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const baseSessionType: SessionType = user.role ? 'member' : 'branch';
  user.sessionType = baseSessionType;

  if (baseSessionType === 'branch') {
    if (!user.tenantId) {
      (res as any).fail ? (res as any).fail(409, 'Tenant not set') : res.status(409).json({ message: 'Tenant not set' });
      return;
    }
    if (!user.locationId) {
      (res as any).fail
        ? (res as any).fail(409, 'Device not assigned to a location')
        : res.status(409).json({ message: 'Device not assigned to a location' });
      return;
    }
  }

  if (baseSessionType === 'member') {
    const viewAs = (req.header('x-view-as') || '').toLowerCase();
    const requestedLoc = (req.header('x-location-id') || '').trim();

    if (viewAs === 'branch') {
      if (!user.tenantId) {
        (res as any).fail ? (res as any).fail(409, 'Tenant not set') : res.status(409).json({ message: 'Tenant not set' });
        return;
      }
      if (!requestedLoc || !ObjectId.isValid(requestedLoc)) {
        (res as any).fail
          ? (res as any).fail(400, 'x-location-id is required for view-as branch')
          : res.status(400).json({ message: 'x-location-id is required for view-as branch' });
        return;
      }

      const loc = await client
        .db('authDB')
        .collection('locations')
        .findOne({ _id: new ObjectId(requestedLoc), tenantId: new ObjectId(user.tenantId) });

      if (!loc) {
        (res as any).fail ? (res as any).fail(404, 'Location not found') : res.status(404).json({ message: 'Location not found' });
        return;
      }

      user.viewAs = 'branch';
      user.locationId = requestedLoc;
    }
  }

  const effectiveType: SessionType = user.viewAs ?? user.sessionType;
  user.capabilities = computeCapabilities({
    role: user.role,
    sessionType: effectiveType,
    viewAs: user.viewAs,
  });

  next();
}

export default applyScope;