import type { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { client } from '../db.js';
import type { LocationDoc } from '../models/Location.js';

function col() {
  return client.db('authDB').collection<LocationDoc>('locations');
}
function usersCol() {
  return client.db('authDB').collection('users');
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  address: z.string().trim().optional().default(''),
  zip: z.string().trim().optional().default(''),
  country: z.string().trim().optional().default(''),
});
const updateSchema = createSchema.partial();

function getTenantId(req: Request): string {
  const t =
    (req as any).user?.tenantId ||
    (req as any).user?.tenant?._id ||
    (req as any).tenantId ||
    (req as any).auth?.tenantId;
  if (!t) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return String(t);
}

function getUserId(req: Request): string {
  const u = (req as any).user?.id;
  if (!u) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return String(u);
}

// Safely derive the user's ObjectId
function getUserObjectId(req: Request): ObjectId {
  const u = (req as any).user || {};
  const candidates = [u.id, u._id, u.sub, (req as any).userId, (req as any).auth?.userId]
    .filter(Boolean)
    .map(String);

  const valid = candidates.find((v) => ObjectId.isValid(v));
  if (!valid) {
    throw Object.assign(new Error('Invalid user id'), { status: 401 });
  }
  return new ObjectId(valid);
}

function toDTO(doc: LocationDoc) {
  return {
    id: (doc._id as ObjectId).toString(),
    name: doc.name,
    address: doc.address || '',
    zip: doc.zip || '',
    country: doc.country || '',
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function isCentral(req: Request): boolean {
  return !Boolean((req as any).user?.role);
}

export async function listLocations(req: Request, res: Response) {
  const tenantId = getTenantId(req);

  // Central device-scoped session -> only return assigned location
  if (isCentral(req) && (req as any).user?.locationId) {
    const loc = await col().findOne({
      _id: new ObjectId((req as any).user.locationId),
      tenantId: new ObjectId(tenantId),
    });
    const items = loc ? [toDTO(loc)] : [];
    return res.ok({ items });
  }

  const items = await col()
    .find({ tenantId: new ObjectId(tenantId) })
    .sort({ createdAt: -1 })
    .toArray();
  return res.ok({ items: items.map(toDTO) });
}

export async function createLocation(req: Request, res: Response) {
  if (isCentral(req)) return res.fail(403, 'Not allowed for device-scoped session');

  const tenantId = getTenantId(req);
  const body = createSchema.parse(req.body);
  const now = new Date();
  const doc: LocationDoc = {
    _id: new ObjectId(),
    tenantId: new ObjectId(tenantId),
    name: body.name,
    address: body.address || '',
    zip: body.zip || '',
    country: body.country || '',
    createdAt: now,
    updatedAt: now,
  };
  try {
    await col().insertOne(doc);

    // Update tenant flags: hasLocations (onboarding + restaurantInfo)
    const tcol = client.db('authDB').collection('tenants');
    await tcol.updateOne(
      { _id: new ObjectId(tenantId) },
      {
        $set: {
          'onboardingProgress.hasLocations': true,
          'restaurantInfo.hasLocations': true,
          updatedAt: now,
        },
      }
    );

    return res.ok({ item: toDTO(doc) }, 201);
  } catch (e: any) {
    if (e?.code === 11000) return res.fail(409, 'Location name already exists');
    throw e;
  }
}

export async function updateLocation(req: Request, res: Response) {
  if (isCentral(req)) return res.fail(403, 'Not allowed for device-scoped session');

  const tenantId = getTenantId(req);
  const { id } = req.params;
  const patch = updateSchema.parse(req.body);

  const $set: Partial<LocationDoc> = { updatedAt: new Date() };
  if (patch.name !== undefined) $set.name = patch.name;
  if (patch.address !== undefined) $set.address = patch.address || '';
  if (patch.zip !== undefined) $set.zip = patch.zip || '';
  if (patch.country !== undefined) $set.country = patch.country || '';

  try {
    const doc = await col().findOneAndUpdate(
      { _id: new ObjectId(id), tenantId: new ObjectId(tenantId) },
      { $set },
      {
        returnDocument: 'after',
        collation: { locale: 'en', strength: 2 },
        includeResultMetadata: false,
      }
    );

    if (!doc) return res.fail(404, 'Location not found');
    return res.ok({ item: toDTO(doc) });
  } catch (e: any) {
    if (e?.code === 11000) return res.fail(409, 'Location name already exists');
    throw e;
  }
}

export async function deleteLocation(req: Request, res: Response) {
  if (isCentral(req)) return res.fail(403, 'Not allowed for device-scoped session');

  const tenantId = getTenantId(req);
  const { id } = req.params;

  const doc = await col().findOneAndDelete(
    { _id: new ObjectId(id), tenantId: new ObjectId(tenantId) },
    { includeResultMetadata: false }
  );

  if (!doc) return res.fail(404, 'Location not found');

  // After deletion, recompute presence of any locations to update tenant flags
  const remaining = await col().countDocuments({ tenantId: new ObjectId(tenantId) });
  const hasAny = remaining > 0;
  const tcol = client.db('authDB').collection('tenants');
  await tcol.updateOne(
    { _id: new ObjectId(tenantId) },
    {
      $set: {
        'onboardingProgress.hasLocations': hasAny,
        'restaurantInfo.hasLocations': hasAny,
        updatedAt: new Date(),
      },
    }
  );

  return res.ok({ item: { id: (doc._id as ObjectId).toString() } });
}

/**
 * Per-user default location (admin/owner). Does not affect other users.
 */
export async function getDefaultLocation(req: Request, res: Response) {
  if (isCentral(req)) return res.fail(403, 'Not allowed for device-scoped session');

  const tenantId = getTenantId(req);
  const userObjectId = getUserObjectId(req);

  const user = await usersCol().findOne(
    { _id: userObjectId },
    { projection: { defaultLocationId: 1 } as any }
  );

  let defId: ObjectId | null = (user as any)?.defaultLocationId || null;

  // Validate that the default belongs to this tenant; otherwise discard
  if (defId) {
    const exists = await col().findOne({ _id: defId, tenantId: new ObjectId(tenantId) });
    if (!exists) defId = null;
  }

  return res.ok({ defaultLocationId: defId ? defId.toHexString() : null });
}

export async function setDefaultLocation(req: Request, res: Response) {
  if (isCentral(req)) return res.fail(403, 'Not allowed for device-scoped session');

  const tenantId = getTenantId(req);
  const userObjectId = getUserObjectId(req);
  const { locationId } = (req.body || {}) as { locationId?: string };

  if (!locationId || !ObjectId.isValid(locationId)) {
    return res.fail(400, 'locationId is required');
  }

  const exists = await col().findOne({
    _id: new ObjectId(locationId),
    tenantId: new ObjectId(tenantId),
  });
  if (!exists) return res.fail(404, 'Location not found');

  await usersCol().updateOne(
    { _id: userObjectId },
    { $set: { defaultLocationId: new ObjectId(locationId) } }
  );

  return res.ok({ defaultLocationId: locationId });
}

/** Clear per-user default location -> next open shows "All locations" */
export async function clearDefaultLocation(req: Request, res: Response) {
  if (isCentral(req)) return res.fail(403, 'Not allowed for device-scoped session');

  const userObjectId = getUserObjectId(req);
  await usersCol().updateOne(
    { _id: userObjectId },
    { $unset: { defaultLocationId: '' } }
  );
  return res.ok({ defaultLocationId: null });
}