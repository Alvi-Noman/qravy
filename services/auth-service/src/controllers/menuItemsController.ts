import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { MenuItemDoc, Variation } from '../models/MenuItem.js';
import type { ItemAvailabilityDoc } from '../models/ItemAvailability.js';
import { toMenuItemDTO } from '../utils/mapper.js';
import { auditLog } from '../utils/audit.js';
import type { TenantDoc } from '../models/Tenant.js';

function col() {
  return client.db('authDB').collection<MenuItemDoc>('menuItems');
}
function tenantsCol() {
  return client.db('authDB').collection<TenantDoc>('tenants');
}
function availabilityCol() {
  return client.db('authDB').collection<ItemAvailabilityDoc>('itemAvailability');
}

function canWrite(role?: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}
function isBranch(req: Request): boolean {
  return !req.user?.role; // device/branch session has no membership role
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeVariations(list: unknown): Array<Pick<Variation, 'name'> & Partial<Variation>> {
  const arr = Array.isArray(list) ? list : [];
  const out: Array<Pick<Variation, 'name'> & Partial<Variation>> = [];
  for (const raw of arr) {
    const r = raw as Record<string, unknown>;
    const name = typeof r?.name === 'string' ? r.name.trim() : '';
    if (!name) continue;
    const p = num(r?.price);
    const imageUrl = typeof r?.imageUrl === 'string' && r.imageUrl.trim() ? (r?.imageUrl as string) : undefined;
    const v: any = { name };
    if (p !== undefined && p >= 0) v.price = p;
    if (imageUrl !== undefined) v.imageUrl = imageUrl;
    out.push(v);
  }
  return out;
}

function firstVariantPrice(variations?: Array<{ price?: number }>): number | undefined {
  if (!Array.isArray(variations)) return undefined;
  for (const v of variations) {
    if (typeof v?.price === 'number' && Number.isFinite(v.price) && v.price >= 0) return v.price;
  }
  return undefined;
}

export async function listMenuItems(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');

    const qLoc = typeof req.query.locationId === 'string' ? req.query.locationId : undefined;
    const filter: any = { tenantId: new ObjectId(tenantId) };

    if (qLoc && ObjectId.isValid(qLoc)) {
      const locId = new ObjectId(qLoc);
      // Include global items (no locationId) + items specifically for this location
      filter.$or = [
        { locationId: { $exists: false } },
        { locationId: null },
        { locationId: locId },
      ];
    }

    const docs = await col().find(filter).sort({ createdAt: -1 }).toArray();

    // If location is specified, apply per-branch availability overlay
    if (qLoc && ObjectId.isValid(qLoc) && docs.length) {
      const locId = new ObjectId(qLoc);
      const itemIds = docs.map((d) => d._id!).filter(Boolean);
      const overlays = await availabilityCol()
        .find({
          tenantId: new ObjectId(tenantId),
          locationId: locId,
          itemId: { $in: itemIds },
        })
        .toArray();
      const overlayMap = new Map<string, boolean>();
      overlays.forEach((o) => overlayMap.set(o.itemId.toString(), !!o.available));

      const items = docs.map((d) => {
        const dto = toMenuItemDTO(d);
        const ov = overlayMap.get(d._id!.toString());
        if (ov !== undefined) {
          dto.hidden = !ov;
          dto.status = ov ? 'active' : 'hidden';
        }
        return dto;
      });

      return res.ok({ items });
    }

    return res.ok({ items: docs.map(toMenuItemDTO) });
  } catch (err) {
    logger.error(`listMenuItems error: ${(err as Error).message}`);
    next(err);
  }
}

export async function createMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    if (isBranch(req)) return res.fail(403, 'Not allowed for branch session');

    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const body = req.body as {
      name: string;
      price?: number | string;
      compareAtPrice?: number | string;
      description?: string;
      category?: string;
      categoryId?: string;
      media?: string[];
      variations?: Array<Variation | Record<string, unknown>>;
      tags?: string[];
      restaurantId?: string;
      hidden?: boolean;
      status?: 'active' | 'hidden';
      locationId?: string; // NEW
    };

    const now = new Date();
    const normVariations = normalizeVariations(body.variations);
    const mainPrice = num(body.price);
    const derived = firstVariantPrice(normVariations);
    const effectivePrice = mainPrice !== undefined ? mainPrice : derived;
    const cmp = num(body.compareAtPrice);
    const effectiveCompareAt =
      effectivePrice !== undefined && cmp !== undefined && cmp >= effectivePrice ? cmp : undefined;

    let hidden = typeof body.hidden === 'boolean' ? body.hidden : false;
    let status: 'active' | 'hidden' = body.status === 'hidden' ? 'hidden' : hidden ? 'hidden' : 'active';

    const doc: any = {
      tenantId: new ObjectId(tenantId),
      createdBy: new ObjectId(userId),
      name: String(body.name || '').trim(),
      createdAt: now,
      updatedAt: now,
      hidden,
      status,
    };

    // Branch scoping
    if (body.locationId && ObjectId.isValid(body.locationId)) {
      doc.locationId = new ObjectId(body.locationId);
      doc.scope = 'location';
    } else {
      doc.scope = 'all';
      doc.locationId = null;
    }

    if (body.restaurantId && ObjectId.isValid(body.restaurantId)) doc.restaurantId = new ObjectId(body.restaurantId);
    if (effectivePrice !== undefined) doc.price = effectivePrice;
    if (effectiveCompareAt !== undefined) doc.compareAtPrice = effectiveCompareAt;
    if (typeof body.description === 'string') doc.description = body.description;
    if (typeof body.category === 'string') doc.category = body.category;
    if (body.categoryId && ObjectId.isValid(body.categoryId)) doc.categoryId = new ObjectId(body.categoryId);

    const media = Array.isArray(body.media) ? body.media.filter((u) => typeof u === 'string' && u) : [];
    if (media.length) doc.media = media;
    if (normVariations.length) doc.variations = normVariations;

    const tags =
      Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : [];
    if (tags.length) doc.tags = tags;

    const result = await col().insertOne(doc);
    const created: MenuItemDoc = { ...doc, _id: result.insertedId };

    await auditLog({
      userId,
      action: 'MENU_ITEM_CREATE',
      after: toMenuItemDTO(created),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      { $set: { 'onboardingProgress.hasMenuItem': true, updatedAt: now } }
    );

    return res.ok({ item: toMenuItemDTO(created) }, 201);
  } catch (err: any) {
    const details = err?.errInfo?.details ? ` | details=${JSON.stringify(err.errInfo.details)}` : '';
    logger.error(`createMenuItem error: ${(err as Error).message}${details}`);
    next(err);
  }
}

export async function updateMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    if (isBranch(req)) return res.fail(403, 'Not allowed for branch session');

    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.fail(400, 'Invalid id');

    const body = req.body as {
      name?: string;
      price?: number | string;
      compareAtPrice?: number | string;
      description?: string;
      category?: string;
      categoryId?: string;
      media?: string[];
      variations?: Array<Variation | Record<string, unknown>>;
      tags?: string[];
      restaurantId?: string;
      hidden?: boolean;
      status?: 'active' | 'hidden';
    };

    const filter = { _id: new ObjectId(id), tenantId: new ObjectId(tenantId) };
    const before = await col().findOne(filter);
    if (!before) return res.fail(404, 'Item not found');

    const setOps: any = { updatedAt: new Date(), updatedBy: new ObjectId(userId) };

    if (body.name !== undefined) setOps.name = String(body.name || '').trim();

    if (body.price !== undefined) {
      const p = num(body.price);
      if (p !== undefined && p >= 0) setOps.price = p;
    }

    if (body.compareAtPrice !== undefined) {
      const cmp = num(body.compareAtPrice);
      const ref = setOps.price ?? before.price;
      if (cmp !== undefined && ref !== undefined && cmp >= ref) setOps.compareAtPrice = cmp;
    }

    if (body.description !== undefined)
      setOps.description = typeof body.description === 'string' ? body.description : undefined;

    if (body.category !== undefined)
      setOps.category = typeof body.category === 'string' ? body.category : undefined;

    if (body.categoryId !== undefined) {
      setOps.categoryId =
        body.categoryId && ObjectId.isValid(body.categoryId) ? new ObjectId(body.categoryId) : undefined;
    }

    if (body.media !== undefined) {
      const media = Array.isArray(body.media) ? body.media.filter((u) => typeof u === 'string' && u) : [];
      setOps.media = media.length ? media : [];
    }

    if (body.variations !== undefined) {
      const norm = normalizeVariations(body.variations);
      setOps.variations = norm;
    }

    if (body.tags !== undefined) {
      const tags = Array.isArray(body.tags)
        ? body.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
        : [];
      setOps.tags = tags;
    }

    if (body.restaurantId !== undefined) {
      setOps.restaurantId =
        body.restaurantId && ObjectId.isValid(body.restaurantId) ? new ObjectId(body.restaurantId) : undefined;
    }

    if (body.hidden !== undefined || body.status !== undefined) {
      const st: 'active' | 'hidden' =
        body.status !== undefined ? (body.status === 'hidden' ? 'hidden' : 'active') : body.hidden ? 'hidden' : 'active';
      setOps.status = st;
      setOps.hidden = st === 'hidden';
    }

    const after = await col().findOneAndUpdate(
      filter,
      { $set: setOps },
      { returnDocument: 'after', includeResultMetadata: false }
    );

    if (!after) return res.fail(404, 'Item not found');

    await auditLog({
      userId,
      action: 'MENU_ITEM_UPDATE',
      before: toMenuItemDTO(before),
      after: toMenuItemDTO(after),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toMenuItemDTO(after) });
  } catch (err: any) {
    const details = err?.errInfo?.details ? ` | details=${JSON.stringify(err.errInfo.details)}` : '';
    logger.error(`updateMenuItem error: ${(err as Error).message}${details}`);
    next(err);
  }
}

export async function deleteMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    if (isBranch(req)) return res.fail(403, 'Not allowed for branch session');

    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.fail(400, 'Invalid id');

    const deleted = await col().findOneAndDelete(
      { _id: new ObjectId(id), tenantId: new ObjectId(tenantId) },
      { includeResultMetadata: false }
    );
    if (!deleted) return res.fail(404, 'Item not found');

    await auditLog({
      userId,
      action: 'MENU_ITEM_DELETE',
      before: toMenuItemDTO(deleted),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    const remaining = await col().countDocuments({ tenantId: new ObjectId(tenantId) });
    await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      { $set: { 'onboardingProgress.hasMenuItem': remaining > 0, updatedAt: new Date() } }
    );

    return res.ok({ deleted: true });
  } catch (err) {
    logger.error(`deleteMenuItem error: ${(err as Error).message}`);
    next(err);
  }
}

export async function bulkSetAvailability(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');

    // Allow if editor/admin/owner OR branch session
    if (!(canWrite(req.user?.role) || isBranch(req))) return res.fail(403, 'Forbidden');

    const { ids, active, locationId } = req.body as { ids: string[]; active: boolean; locationId?: string };
    const oids = (ids || []).filter((s) => ObjectId.isValid(s)).map((s) => new ObjectId(s));
    if (!oids.length) return res.fail(400, 'No valid ids');

    const now = new Date();

    // If a location is specified, upsert availability overlays per item/location
    if (locationId && ObjectId.isValid(locationId)) {
      const locId = new ObjectId(locationId);

      const ops = oids.map((itemId) => ({
        updateOne: {
          filter: { tenantId: new ObjectId(tenantId), itemId, locationId: locId },
          update: {
            $set: { available: !!active, updatedAt: now },
            $setOnInsert: {
              tenantId: new ObjectId(tenantId),
              itemId,
              locationId: locId,
              createdAt: now,
            },
          },
          upsert: true,
        },
      }));

      await availabilityCol().bulkWrite(ops, { ordered: false });

      // Fetch affected items and apply overlay in response
      const docs = await col()
        .find({ _id: { $in: oids }, tenantId: new ObjectId(tenantId) })
        .toArray();

      const items = docs.map((d) => {
        const dto = toMenuItemDTO(d);
        dto.hidden = !active;
        dto.status = active ? 'active' : 'hidden';
        return dto;
      });

      await auditLog({
        userId,
        action: 'MENU_ITEM_BULK_AVAILABILITY',
        after: items,
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      return res.ok({
        matchedCount: oids.length,
        modifiedCount: oids.length,
        items,
      });
    }

    // Otherwise, update global availability on the items
    const st: 'active' | 'hidden' = active ? 'active' : 'hidden';
    const result = await col().updateMany(
      { _id: { $in: oids }, tenantId: new ObjectId(tenantId) },
      { $set: { hidden: !active, status: st, updatedAt: now, updatedBy: new ObjectId(userId) } }
    );

    const docs = await col().find({ _id: { $in: oids }, tenantId: new ObjectId(tenantId) }).toArray();

    await auditLog({
      userId,
      action: 'MENU_ITEM_BULK_AVAILABILITY',
      after: docs.map(toMenuItemDTO),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      items: docs.map(toMenuItemDTO),
    });
  } catch (err) {
    logger.error(`bulkSetAvailability error: ${(err as Error).message}`);
    next(err);
  }
}

export async function bulkDeleteMenuItems(req: Request, res: Response, next: NextFunction) {
  try {
    if (isBranch(req)) return res.fail(403, 'Not allowed for branch session');

    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const { ids } = req.body as { ids: string[] };
    const oids = (ids || []).filter((s) => ObjectId.isValid(s)).map((s) => new ObjectId(s));
    if (!oids.length) return res.fail(400, 'No valid ids');

    const before = await col().find({ _id: { $in: oids }, tenantId: new ObjectId(tenantId) }).toArray();

    const del = await col().deleteMany({ _id: { $in: oids }, tenantId: new ObjectId(tenantId) });

    await auditLog({
      userId,
      action: 'MENU_ITEM_BULK_DELETE',
      before: before.map(toMenuItemDTO),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    const remaining = await col().countDocuments({ tenantId: new ObjectId(tenantId) });
    await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      { $set: { 'onboardingProgress.hasMenuItem': remaining > 0, updatedAt: new Date() } }
    );

    return res.ok({ deletedCount: del.deletedCount, ids });
  } catch (err) {
    logger.error(`bulkDeleteMenuItems error: ${(err as Error).message}`);
    next(err);
  }
}

export async function bulkChangeCategory(req: Request, res: Response, next: NextFunction) {
  try {
    if (isBranch(req)) return res.fail(403, 'Not allowed for branch session');

    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const { ids, category, categoryId } = req.body as {
      ids: string[];
      category?: string;
      categoryId?: string;
    };

    const oids = (ids || []).filter((s) => ObjectId.isValid(s)).map((s) => new ObjectId(s));
    if (!oids.length) return res.fail(400, 'No valid ids');

    const setOps: any = { updatedAt: new Date(), updatedBy: new ObjectId(userId) };
    if (category !== undefined) setOps.category = typeof category === 'string' ? category : undefined;
    if (categoryId !== undefined)
      setOps.categoryId = categoryId && ObjectId.isValid(categoryId) ? new ObjectId(categoryId) : undefined;

    const result = await col().updateMany(
      { _id: { $in: oids }, tenantId: new ObjectId(tenantId) },
      { $set: setOps }
    );

    const docs = await col().find({ _id: { $in: oids }, tenantId: new ObjectId(tenantId) }).toArray();

    await auditLog({
      userId,
      action: 'MENU_ITEM_BULK_CATEGORY',
      after: docs.map(toMenuItemDTO),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      items: docs.map(toMenuItemDTO),
    });
  } catch (err) {
    logger.error(`bulkChangeCategory error: ${(err as Error).message}`);
    next(err);
  }
}