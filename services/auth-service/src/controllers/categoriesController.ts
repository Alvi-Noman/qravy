import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { CategoryDoc } from '../models/Category.js';
import { toCategoryDTO } from '../utils/mapper.js';
import { auditLog } from '../utils/audit.js';
import type { TenantDoc } from '../models/Tenant.js';

function categoriesCol() {
  return client.db('authDB').collection<CategoryDoc>('categories');
}
function menuItemsCol() {
  return client.db('authDB').collection('menuItems');
}
function tenantsCol() {
  return client.db('authDB').collection<TenantDoc>('tenants');
}
function locationsCol() {
  return client.db('authDB').collection('locations');
}

function canWrite(role?: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}
function isBranch(req: Request): boolean {
  return !req.user?.role; // central device/branch session has no membership role
}

function parseChannel(v: unknown): 'dine-in' | 'online' | undefined {
  return v === 'dine-in' || v === 'online' ? v : undefined;
}

/**
 * Derive a target locationId for branch-scoped operations.
 * - Branch session: from req.user.locationId (required)
 * - Member (owner/admin): from req.query.locationId or req.body.locationId (optional; validate format)
 */
function getTargetLocationId(req: Request): ObjectId | null {
  if (isBranch(req)) {
    const lid = req.user?.locationId;
    if (lid && ObjectId.isValid(lid)) return new ObjectId(lid);
    return null;
  }
  const q = (req.query.locationId as string | undefined) || (req.body?.locationId as string | undefined);
  if (q && ObjectId.isValid(q)) return new ObjectId(q);
  return null;
}

/**
 * List categories:
 * - If a locationId is provided (or branch session has one), return UNION of:
 *   scope='all' AND scope='location' for that locationId.
 * - If no locationId (All locations), return global + ALL branch categories.
 * - If channel is provided, include categories with channelScope='all' or that channel (or missing field).
 */
export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');

    const tenantOid = new ObjectId(tenantId);
    const locId = getTargetLocationId(req);
    const qCh = parseChannel(req.query.channel);

    const orTerms: any[] = [
      { scope: 'all' },
      { scope: { $exists: false } }, // legacy docs
    ];
    if (locId) {
      // Specific branch view: include only that branch's categories (plus global)
      orTerms.push({ scope: 'location', locationId: locId });
    } else {
      // "All locations" view: include global + ALL branch categories
      orTerms.push({ scope: 'location' });
    }

    const filter: any = { tenantId: tenantOid, $or: orTerms };

    if (qCh) {
      // Limit by channel: include 'all' or the selected channel, and legacy without the field
      filter.$and = [
        {
          $or: [
            { channelScope: 'all' },
            { channelScope: qCh },
            { channelScope: { $exists: false } },
          ],
        },
      ];
    }

    const docs = await categoriesCol().find(filter).sort({ name: 1 }).toArray();

    return res.ok({ items: docs.map(toCategoryDTO) });
  } catch (err) {
    logger.error(`listCategories error: ${(err as Error).message}`);
    next(err);
  }
}

/**
 * Create:
 * - Member (owner/admin):
 *   - if body.locationId present -> scope='location' for that location
 *   - else -> scope='all'
 * - Channel:
 *   - if body.channel present -> channelScope=that channel
 *   - else -> channelScope='all' (All channels)
 * - Branch session: 403
 */
export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    if (isBranch(req)) return res.fail(403, 'Not allowed for branch session');

    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const { name, locationId, channel } = (req.body || {}) as {
      name: string;
      locationId?: string;
      channel?: 'dine-in' | 'online';
    };

    const now = new Date();
    const doc: CategoryDoc = {
      tenantId: new ObjectId(tenantId),
      createdBy: new ObjectId(userId),
      name: String(name || '').trim(),
      createdAt: now,
      updatedAt: now,
    };

    // Branch-aware scoping
    const locIdStr = typeof locationId === 'string' && locationId.trim() ? locationId.trim() : '';
    if (locIdStr) {
      if (!ObjectId.isValid(locIdStr)) return res.fail(400, 'Invalid locationId');
      const exists = await locationsCol().findOne({
        _id: new ObjectId(locIdStr),
        tenantId: new ObjectId(tenantId),
      });
      if (!exists) return res.fail(404, 'Location not found');
      (doc as any).scope = 'location';
      (doc as any).locationId = new ObjectId(locIdStr);
    } else {
      (doc as any).scope = 'all';
      (doc as any).locationId = null;
    }

    // Channel scope
    const ch = parseChannel(channel);
    (doc as any).channelScope = ch ? ch : 'all';

    const result = await categoriesCol().insertOne(doc);
    const created: CategoryDoc = { ...doc, _id: result.insertedId };

    await auditLog({
      userId,
      action: 'CATEGORY_CREATE',
      after: toCategoryDTO(created),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      { $set: { 'onboardingProgress.hasCategory': true, updatedAt: now } }
    );

    return res.ok({ item: toCategoryDTO(created) }, 201);
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 11000) return res.fail(409, 'Category already exists.');
    logger.error(`createCategory error: ${(err as Error).message}`);
    next(err);
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    if (isBranch(req)) return res.fail(403, 'Not allowed for branch session');

    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const { id } = req.params;
    const { name } = (req.body || {}) as { name: string };
    if (!ObjectId.isValid(id)) return res.fail(400, 'Invalid id');

    const filter = { _id: new ObjectId(id), tenantId: new ObjectId(tenantId) };
    const before = await categoriesCol().findOne(filter);
    if (!before) return res.fail(404, 'Category not found');

    const doc = await categoriesCol().findOneAndUpdate(
      filter,
      { $set: { name: String(name || '').trim(), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!doc) return res.fail(404, 'Category not found');

    await auditLog({
      userId,
      action: 'CATEGORY_UPDATE',
      before: toCategoryDTO(before),
      after: toCategoryDTO(doc),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toCategoryDTO(doc) });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 11000) return res.fail(409, 'Category already exists.');
    logger.error(`updateCategory error: ${(err as Error).message}`);
    next(err);
  }
}

export async function deleteCategory(req: Request, res: Response, next: NextFunction) {
  try {
    if (isBranch(req)) return res.fail(403, 'Not allowed for branch session');

    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.fail(400, 'Invalid id');

    const filter = { _id: new ObjectId(id), tenantId: new ObjectId(tenantId) };
    const cat = await categoriesCol().findOne(filter);
    if (!cat) return res.fail(404, 'Category not found');

    // Cascade delete only within the same branch scope
    let itemFilter: any = {
      tenantId: new ObjectId(tenantId),
      category: cat.name,
    };

    const scope = (cat as any).scope as 'all' | 'location' | undefined;
    const catLoc = (cat as any).locationId as ObjectId | undefined | null;

    if (scope === 'location' && catLoc) {
      itemFilter.locationId = catLoc;
    } else {
      // global: only delete global items (not branch-scoped items)
      itemFilter.$or = [{ locationId: { $exists: false } }, { locationId: null }];
    }

    const delItems = await menuItemsCol().deleteMany(itemFilter);
    await categoriesCol().deleteOne(filter);

    const [remainingCategories, remainingItems] = await Promise.all([
      categoriesCol().countDocuments({ tenantId: new ObjectId(tenantId) }),
      menuItemsCol().countDocuments({ tenantId: new ObjectId(tenantId) }),
    ]);

    await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      {
        $set: {
          'onboardingProgress.hasCategory': remainingCategories > 0,
          'onboardingProgress.hasMenuItem': remainingItems > 0,
          updatedAt: new Date(),
        },
      }
    );

    await auditLog({
      userId,
      action: 'CATEGORY_DELETE',
      before: toCategoryDTO(cat),
      metadata: { deletedProducts: delItems.deletedCount || 0 },
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    logger.info(
      `Category deleted: ${cat.name} for tenant ${tenantId}. Also deleted ${delItems.deletedCount || 0} scoped menu items.`
    );

    return res.ok({ deleted: true, deletedProducts: delItems.deletedCount || 0 });
  } catch (err) {
    logger.error(`deleteCategory error: ${(err as Error).message}`);
    next(err);
  }
}