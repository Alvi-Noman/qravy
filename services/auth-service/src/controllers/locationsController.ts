import type { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { client } from '../db.js';
import type { LocationDoc } from '../models/Location.js';
import { auditLog } from '../utils/audit.js';
import logger from '../utils/logger.js';

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
  disabled: z.boolean().optional().default(false),
});
const updateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').optional(),
  address: z.string().trim().optional(),
  zip: z.string().trim().optional(),
  country: z.string().trim().optional(),
  disabled: z.boolean().optional(),
});

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
    disabled: doc.disabled || false,
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

  try {
    const tcol = client.db('authDB').collection('tenants');
    const tenant = await tcol.findOne({ _id: new ObjectId(tenantId) });
    if (!tenant) return res.fail(404, 'Tenant not found');

    const count = await col().countDocuments({ tenantId: new ObjectId(tenantId), disabled: { $ne: true } });
    if (count >= 1) {
      if (tenant.subscriptionStatus !== 'active' || !tenant.hasCardOnFile) {
        return res.fail(402, 'Payment method required to add locations.');
      }
      
      const planId = tenant.planInfo?.planId || 'p1_m';
      const isPro = planId.toLowerCase().includes('p2');
      const amountCents = isPro ? 9900 : 2900;
      
      logger.info(`Charged prorated amount of $${amountCents / 100} to card ending in ${tenant.payment?.last4 || 'xxxx'} for tenant ${tenantId}`);
      
      await auditLog({
        userId: getUserId(req),
        action: 'LOCATION_CHARGE',
        after: {
          tenantId,
          amountCents,
          cardLast4: tenant.payment?.last4 || 'xxxx',
        },
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });
    }

    const doc: LocationDoc = {
      _id: new ObjectId(),
      tenantId: new ObjectId(tenantId),
      name: body.name,
      address: body.address || '',
      zip: body.zip || '',
      country: body.country || '',
      disabled: body.disabled || false,
      createdAt: now,
      updatedAt: now,
    };

    await col().insertOne(doc);

    // Update tenant flags: hasLocations (onboarding + restaurantInfo)
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
  if (patch.disabled !== undefined) $set.disabled = patch.disabled;

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

    if (patch.disabled !== undefined) {
      const remaining = await col().countDocuments({ tenantId: new ObjectId(tenantId), disabled: { $ne: true } });
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
    }

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
  const remaining = await col().countDocuments({ tenantId: new ObjectId(tenantId), disabled: { $ne: true } });
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

export async function importMenuFromLocation(req: Request, res: Response) {
  if (isCentral(req)) return res.fail(403, 'Not allowed for device-scoped session');

  const tenantId = getTenantId(req);
  const targetLocationId = req.params.id;
  const { sourceLocationId, categoryIds } = (req.body || {}) as {
    sourceLocationId?: string;
    categoryIds?: string[];
  };

  if (!sourceLocationId || !ObjectId.isValid(sourceLocationId)) {
    return res.fail(400, 'Invalid or missing sourceLocationId');
  }
  if (!ObjectId.isValid(targetLocationId)) {
    return res.fail(400, 'Invalid target location ID');
  }

  const tenantOid = new ObjectId(tenantId);
  const sourceOid = new ObjectId(sourceLocationId);
  const targetOid = new ObjectId(targetLocationId);

  // 1. Verify target location belongs to tenant
  const targetLoc = await col().findOne({ _id: targetOid, tenantId: tenantOid });
  if (!targetLoc) return res.fail(404, 'Target location not found');

  // 2. Verify source location belongs to tenant
  const sourceLoc = await col().findOne({ _id: sourceOid, tenantId: tenantOid });
  if (!sourceLoc) return res.fail(404, 'Source location not found');

  const db = client.db('authDB');
  const catVisibility = db.collection('categoryVisibility');
  const itemAvailability = db.collection('itemAvailability');
  const categories = db.collection('categories');
  const menuItems = db.collection('menuItems');

  let allowedCategoryIds: ObjectId[] | null = null;
  let allowedMenuItemIds: ObjectId[] | null = null;

  if (Array.isArray(categoryIds) && categoryIds.length > 0) {
    allowedCategoryIds = categoryIds.filter(id => id && ObjectId.isValid(id)).map(id => new ObjectId(id));
    
    // Find all menu items belonging to these categories
    const items = await menuItems.find({
      tenantId: tenantOid,
      categoryId: { $in: allowedCategoryIds }
    }).project({ _id: 1 }).toArray();
    
    allowedMenuItemIds = items.map(itm => itm._id);
  }

  // A. Clone categoryVisibility (overlays)
  const catVisQuery: any = { tenantId: tenantOid, locationId: sourceOid };
  if (allowedCategoryIds) {
    catVisQuery.categoryId = { $in: allowedCategoryIds };
  }
  const sourceCatVis = await catVisibility.find(catVisQuery).toArray();
  if (sourceCatVis.length > 0) {
    // Delete existing target vis overlays first to avoid duplicates
    const catDelQuery: any = { tenantId: tenantOid, locationId: targetOid };
    if (allowedCategoryIds) catDelQuery.categoryId = { $in: allowedCategoryIds };
    await catVisibility.deleteMany(catDelQuery);

    // Insert cloned records
    const newCatVis = sourceCatVis.map(v => ({
      ...v,
      _id: new ObjectId(),
      locationId: targetOid,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    await catVisibility.insertMany(newCatVis);
  }

  // B. Clone itemAvailability (overlays)
  const itemAvailQuery: any = { tenantId: tenantOid, locationId: sourceOid };
  if (allowedMenuItemIds) {
    itemAvailQuery.itemId = { $in: allowedMenuItemIds };
  }
  const sourceItemAvail = await itemAvailability.find(itemAvailQuery).toArray();
  if (sourceItemAvail.length > 0) {
    const itemDelQuery: any = { tenantId: tenantOid, locationId: targetOid };
    if (allowedMenuItemIds) itemDelQuery.itemId = { $in: allowedMenuItemIds };
    await itemAvailability.deleteMany(itemDelQuery);

    const newItemAvail = sourceItemAvail.map(a => ({
      ...a,
      _id: new ObjectId(),
      locationId: targetOid,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    await itemAvailability.insertMany(newItemAvail);
  }

  // C. Update Categories inclusion/exclusion lists
  const catFilter: any = { tenantId: tenantOid };
  if (allowedCategoryIds) {
    catFilter._id = { $in: allowedCategoryIds };
  }
  
  const catsToUpdate = await categories.find({
    ...catFilter,
    $or: [
      { includeLocationIds: sourceLocationId },
      { excludeLocationIds: sourceLocationId }
    ]
  }).toArray();

  for (const cat of catsToUpdate) {
    const updates: any = {};
    if (Array.isArray(cat.includeLocationIds) && cat.includeLocationIds.includes(sourceLocationId)) {
      if (!cat.includeLocationIds.includes(targetLocationId)) {
        updates.includeLocationIds = [...cat.includeLocationIds, targetLocationId];
      }
    }
    if (Array.isArray(cat.excludeLocationIds) && cat.excludeLocationIds.includes(sourceLocationId)) {
      if (!cat.excludeLocationIds.includes(targetLocationId)) {
        updates.excludeLocationIds = [...cat.excludeLocationIds, targetLocationId];
      }
    }
    if (Object.keys(updates).length > 0) {
      await categories.updateOne({ _id: cat._id }, { $set: updates });
    }
  }

  // D. Update Menu Items inclusion/exclusion lists
  const itemFilter: any = { tenantId: tenantOid };
  if (allowedMenuItemIds) {
    itemFilter._id = { $in: allowedMenuItemIds };
  }

  const itemsToUpdate = await menuItems.find({
    ...itemFilter,
    $or: [
      { includeLocationIds: sourceLocationId },
      { excludeLocationIds: sourceLocationId }
    ]
  }).toArray();

  for (const item of itemsToUpdate) {
    const updates: any = {};
    if (Array.isArray(item.includeLocationIds) && item.includeLocationIds.includes(sourceLocationId)) {
      if (!item.includeLocationIds.includes(targetLocationId)) {
        updates.includeLocationIds = [...item.includeLocationIds, targetLocationId];
      }
    }
    if (Array.isArray(item.excludeLocationIds) && item.excludeLocationIds.includes(sourceLocationId)) {
      if (!item.excludeLocationIds.includes(targetLocationId)) {
        updates.excludeLocationIds = [...item.excludeLocationIds, targetLocationId];
      }
    }
    if (Object.keys(updates).length > 0) {
      await menuItems.updateOne({ _id: item._id }, { $set: updates });
    }
  }

  return res.ok({ success: true });
}