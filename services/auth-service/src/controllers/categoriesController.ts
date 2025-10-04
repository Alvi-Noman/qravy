import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { CategoryDoc } from '../models/Category.js';
import type { CategoryVisibilityDoc } from '../models/CategoryVisibility.js';
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
function categoryVisibilityCol() {
  return client.db('authDB').collection<CategoryVisibilityDoc>('categoryVisibility');
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

function channelAllowed(cat: CategoryDoc, ch: 'dine-in' | 'online'): boolean {
  const scope = (cat as any).channelScope as 'all' | 'dine-in' | 'online' | undefined;
  if (!scope || scope === 'all') return true;
  return scope === ch;
}

export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');

    const tenantOid = new ObjectId(tenantId);
    const locId = getTargetLocationId(req);
    const qCh = parseChannel(req.query.channel);

    // Fetch base category docs (respect channelScope if qCh is set)
    const orTerms: any[] = [{ scope: 'all' }, { scope: { $exists: false } }];
    if (locId) {
      orTerms.push({ scope: 'location', locationId: locId });
    } else {
      orTerms.push({ scope: 'location' }); // include branch-scoped for global view too
    }

    const baseFilter: any = { tenantId: tenantOid, $or: orTerms };
    if (qCh) {
      baseFilter.$and = [
        { $or: [{ channelScope: 'all' }, { channelScope: qCh }, { channelScope: { $exists: false } }] },
      ];
    }

    const docs = await categoriesCol().find(baseFilter).sort({ name: 1 }).toArray();
    if (docs.length === 0) return res.ok({ items: [] });

    // BRANCH VIEW: keep previous logic (overlay + tombstones for this location only)
    if (locId) {
      const visQuery: any = {
        tenantId: tenantOid,
        locationId: locId,
        categoryId: { $in: docs.map((d) => d._id!).filter(Boolean) },
      };
      if (qCh) visQuery.channel = qCh;

      const visOverlays = await categoryVisibilityCol().find(visQuery).toArray();

      const overlayByCat = new Map<string, Map<'dine-in' | 'online', boolean>>();
      const removedByCat  = new Map<string, Set<'dine-in' | 'online'>>();
      for (const v of visOverlays as any[]) {
        const catKey = v.categoryId.toString();
        const ch = v.channel as 'dine-in' | 'online';
        if (v.removed === true) {
          const set = removedByCat.get(catKey) ?? new Set<'dine-in' | 'online'>();
          set.add(ch);
          removedByCat.set(catKey, set);
        } else {
          const m = overlayByCat.get(catKey) ?? new Map<'dine-in' | 'online', boolean>();
          m.set(ch, !!v.visible);
          overlayByCat.set(catKey, m);
        }
      }

      const isVisibleInBranch = (cat: CategoryDoc, ch: 'dine-in' | 'online'): boolean => {
        if (!channelAllowed(cat, ch)) return false;
        const ov = overlayByCat.get(cat._id!.toString())?.get(ch);
        if (ov !== undefined) return ov;
        return true; // baseline visible
      };

      const filtered = docs.filter((cat) => {
        const removedSet = removedByCat.get(cat._id!.toString());
        if (qCh) {
          if (removedSet?.has(qCh)) return false;
          return isVisibleInBranch(cat, qCh);
        }
        const fullyRemoved = removedSet && ['dine-in', 'online'].every((c) => removedSet.has(c as any));
        if (fullyRemoved) return false;
        return isVisibleInBranch(cat, 'dine-in') || isVisibleInBranch(cat, 'online');
      });

      return res.ok({ items: filtered.map(toCategoryDTO) });
    }

    // GLOBAL VIEW (ALL LOCATIONS): new logic to hide categories removed everywhere
    // 1) Load all tenant locations (needed to evaluate "exists anywhere?")
    const locDocs = await locationsCol().find({ tenantId: tenantOid }, { projection: { _id: 1 } }).toArray();
    const locIds = locDocs.map((l: any) => l._id as ObjectId);
    const locCount = locIds.length;

    // 2) Load all visibility overlays/tombstones for these categories across all locations
    const visQueryAll: any = {
      tenantId: tenantOid,
      categoryId: { $in: docs.map((d) => d._id!).filter(Boolean) },
    };
    if (locCount > 0) visQueryAll.locationId = { $in: locIds };
    if (qCh) visQueryAll.channel = qCh;

    const overlaysAll = await categoryVisibilityCol().find(visQueryAll).toArray();

    // overlayByCatAll: cat -> channel -> loc -> visible(bool)
    const overlayByCatAll = new Map<string, Map<'dine-in' | 'online', Map<string, boolean>>>();
    // removedByCatAll: cat -> channel -> Set<loc>
    const removedByCatAll = new Map<string, Map<'dine-in' | 'online', Set<string>>>();

    for (const v of overlaysAll as any[]) {
      const catKey = v.categoryId.toString();
      const ch = v.channel as 'dine-in' | 'online';
      const locKey = v.locationId.toString();
      if (v.removed === true) {
        const chMap = removedByCatAll.get(catKey) ?? new Map();
        const set = chMap.get(ch) ?? new Set<string>();
        set.add(locKey);
        chMap.set(ch, set);
        removedByCatAll.set(catKey, chMap);
      } else {
        const chMap = overlayByCatAll.get(catKey) ?? new Map();
        const locMap = chMap.get(ch) ?? new Map<string, boolean>();
        locMap.set(locKey, !!v.visible);
        chMap.set(ch, locMap);
        overlayByCatAll.set(catKey, chMap);
      }
    }

    const channelsToEval = qCh ? [qCh] as const : (['dine-in', 'online'] as const);

    const existsAnywhereForChannel = (cat: CategoryDoc, ch: 'dine-in' | 'online'): boolean => {
      if (!channelAllowed(cat, ch)) return false;

      // If no locations exist yet, baseline visibility decides
      if (locCount === 0) return true;

      const perChLoc = overlayByCatAll.get(cat._id!.toString())?.get(ch) ?? new Map<string, boolean>();
      const removedLocs = removedByCatAll.get(cat._id!.toString())?.get(ch) ?? new Set<string>();

      for (const lid of locIds) {
        const key = lid.toString();
        if (removedLocs.has(key)) continue;               // tombstoned in this loc+ch
        const ov = perChLoc.get(key);
        const finalVisible = ov !== undefined ? ov : true; // baseline visible = true
        if (finalVisible) return true;
      }
      return false;
    };

    const filteredGlobal = docs.filter((cat) => {
      if (qCh) {
        // Show only if it exists in at least one location for this channel
        return existsAnywhereForChannel(cat, qCh);
      }
      // All channels: keep if it exists in any channel in any location
      return existsAnywhereForChannel(cat, 'dine-in') || existsAnywhereForChannel(cat, 'online');
    });

    return res.ok({ items: filteredGlobal.map(toCategoryDTO) });
  } catch (err) {
    logger.error(`listCategories error: ${(err as Error).message}`);
    next(err);
  }
}

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    if (isBranch(req)) return res.fail(403, 'Not allowed for branch session');

    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const { name, locationId, channel, includeLocationIds, excludeLocationIds } = (req.body || {}) as {
      name: string;
      locationId?: string;
      channel?: 'dine-in' | 'online';
      includeLocationIds?: string[];
      excludeLocationIds?: string[];
    };

    const now = new Date();
    const tenantOid = new ObjectId(tenantId);

    const doc: CategoryDoc = {
      tenantId: tenantOid,
      createdBy: new ObjectId(userId),
      name: String(name || '').trim(),
      createdAt: now,
      updatedAt: now,
    } as CategoryDoc;

    // Branch-aware scoping
    const locIdStr = typeof locationId === 'string' && locationId.trim() ? locationId.trim() : '';
    const isBranchScoped = !!locIdStr;
    if (isBranchScoped) {
      if (!ObjectId.isValid(locIdStr)) return res.fail(400, 'Invalid locationId');
      const exists = await locationsCol().findOne({ _id: new ObjectId(locIdStr), tenantId: tenantOid });
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

    // Seed overlays for GLOBAL categories only
    if (!isBranchScoped) {
      const seedChs: Array<'dine-in' | 'online'> = ch ? [ch] : ['dine-in', 'online'];
      const rawInclude = Array.isArray(includeLocationIds) ? includeLocationIds : [];
      const rawExclude = Array.isArray(excludeLocationIds) ? excludeLocationIds : [];

      if (rawInclude.length || rawExclude.length) {
        const validInclude = rawInclude.filter((s) => ObjectId.isValid(s)).map((s) => new ObjectId(s));
        const validExclude = rawExclude.filter((s) => ObjectId.isValid(s)).map((s) => new ObjectId(s));

        const wanted = [...validInclude, ...validExclude];
        const locs = await locationsCol()
          .find({ _id: { $in: wanted }, tenantId: tenantOid }, { projection: { _id: 1 } })
          .toArray();
        const allowed = new Set(locs.map((l: any) => (l._id as ObjectId).toString()));
        const includeIds = validInclude.filter((id) => allowed.has(id.toString()));
        const excludeIds = validExclude.filter((id) => allowed.has(id.toString()));

        const ops: any[] = [];

        if (includeIds.length) {
          // Explicitly visible at these branches/channels (clear any "removed" tombstone)
          for (const lid of includeIds) {
            for (const c of seedChs) {
              ops.push({
                updateOne: {
                  filter: { tenantId: tenantOid, categoryId: created._id!, locationId: lid, channel: c },
                  update: {
                    $set: { visible: true, updatedAt: now },
                    $unset: { removed: '' },
                    $setOnInsert: {
                      tenantId: tenantOid,
                      categoryId: created._id!,
                      locationId: lid,
                      channel: c,
                      createdAt: now,
                    },
                  },
                  upsert: true,
                },
              });
            }
          }
        } else if (excludeIds.length) {
          // **Hard exclusion** at these branches/channels (tombstone)
          for (const lid of excludeIds) {
            for (const c of seedChs) {
              ops.push({
                updateOne: {
                  filter: { tenantId: tenantOid, categoryId: created._id!, locationId: lid, channel: c },
                  update: {
                    $set: { removed: true, updatedAt: now },
                    $unset: { visible: '' },
                    $setOnInsert: {
                      tenantId: tenantOid,
                      categoryId: created._id!,
                      locationId: lid,
                      channel: c,
                      createdAt: now,
                    },
                  },
                  upsert: true,
                },
              });
            }
          }
        }

        if (ops.length) await categoryVisibilityCol().bulkWrite(ops, { ordered: false });
      }
    }

    await auditLog({
      userId,
      action: 'CATEGORY_CREATE',
      after: toCategoryDTO(created),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    await tenantsCol().updateOne(
      { _id: tenantOid },
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

    const tenantOid = new ObjectId(tenantId);
    const filter = { _id: new ObjectId(id), tenantId: tenantOid };
    const cat = await categoriesCol().findOne(filter);
    if (!cat) return res.fail(404, 'Category not found');

    const qLoc = typeof req.query.locationId === 'string' ? req.query.locationId : undefined;
    const qCh = parseChannel(req.query.channel);
    const now = new Date();

    // Location + Channel: remove only that location+channel
    if (qLoc && ObjectId.isValid(qLoc) && qCh) {
      const locId = new ObjectId(qLoc);
      const scope = (cat as any).scope as 'all' | 'location' | undefined;
      const catLoc = (cat as any).locationId as ObjectId | undefined | null;

      if (scope === 'location' && catLoc && catLoc.toString() === locId.toString()) {
        // Branch-scoped: narrow channelScope to opposite channel
        const newScope = qCh === 'dine-in' ? 'online' : 'dine-in';
        await categoriesCol().updateOne(filter, {
          $set: { channelScope: newScope, updatedAt: now },
        });
        // Clean overlays for this loc+channel
        await categoryVisibilityCol().deleteMany({
          tenantId: tenantOid,
          categoryId: cat._id!,
          locationId: locId,
          channel: qCh,
        });
      } else {
        // Global: write per-location+channel tombstone (removed)
        await categoryVisibilityCol().updateOne(
          { tenantId: tenantOid, categoryId: cat._id!, locationId: locId, channel: qCh },
          {
            $set: { removed: true, updatedAt: now },
            $unset: { visible: '' },
            $setOnInsert: {
              tenantId: tenantOid,
              categoryId: cat._id!,
              locationId: locId,
              channel: qCh,
              createdAt: now,
            },
          },
          { upsert: true }
        );
      }

      await auditLog({
        userId,
        action: 'CATEGORY_DELETE',
        before: toCategoryDTO(cat),
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      return res.ok({ deleted: true });
    }

    // Location only: remove from that location (both channels)
    if (qLoc && ObjectId.isValid(qLoc) && !qCh) {
      const locId = new ObjectId(qLoc);
      const scope = (cat as any).scope as 'all' | 'location' | undefined;
      const catLoc = (cat as any).locationId as ObjectId | undefined | null;

      if (scope === 'location' && catLoc && catLoc.toString() === locId.toString()) {
        // Branch-scoped: hard delete this category doc + cascade delete items in this branch
        let itemFilter: any = {
          tenantId: tenantOid,
          category: cat.name,
          locationId: locId,
        };
        const delItems = await menuItemsCol().deleteMany(itemFilter);
        await categoriesCol().deleteOne(filter);

        // Cleanup overlays for this category/location
        await categoryVisibilityCol().deleteMany({
          tenantId: tenantOid,
          categoryId: cat._id!,
          locationId: locId,
        });

        const [remainingCategories, remainingItems] = await Promise.all([
          categoriesCol().countDocuments({ tenantId: tenantOid }),
          menuItemsCol().countDocuments({ tenantId: tenantOid }),
        ]);

        await tenantsCol().updateOne(
          { _id: tenantOid },
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
          `Category deleted: ${cat.name} for tenant ${tenantId} in location ${locId.toString()}. Also deleted ${delItems.deletedCount || 0} scoped menu items.`
        );

        return res.ok({ deleted: true, deletedProducts: delItems.deletedCount || 0 });
      } else {
        // Global: write location tombstones for both channels
        const ops: any[] = [];
        for (const c of ['dine-in', 'online'] as const) {
          ops.push({
            updateOne: {
              filter: { tenantId: tenantOid, categoryId: cat._id!, locationId: locId, channel: c },
              update: {
                $set: { removed: true, updatedAt: now },
                $unset: { visible: '' },
                $setOnInsert: {
                  tenantId: tenantOid,
                  categoryId: cat._id!,
                  locationId: locId,
                  channel: c,
                  createdAt: now,
                },
              },
              upsert: true,
            },
          });
        }
        if (ops.length) await categoryVisibilityCol().bulkWrite(ops, { ordered: false });

        await auditLog({
          userId,
          action: 'CATEGORY_DELETE',
          before: toCategoryDTO(cat),
          ip: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });

        return res.ok({ deleted: true });
      }
    }

    // Channel only: remove from this channel across all locations
    if (!qLoc && qCh) {
      const newScope = qCh === 'dine-in' ? 'online' : 'dine-in';
      await categoriesCol().updateOne(filter, {
        $set: { channelScope: newScope, updatedAt: now },
      });
      // Remove any overlays for this channel across all locations
      await categoryVisibilityCol().deleteMany({
        tenantId: tenantOid,
        categoryId: cat._id!,
        channel: qCh,
      });

      await auditLog({
        userId,
        action: 'CATEGORY_DELETE',
        before: toCategoryDTO(cat),
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      return res.ok({ deleted: true });
    }

    // No scope: hard delete everywhere + cascade + cleanup overlays
    // Cascade delete only within the same branch scope (existing logic)
    let itemFilter: any = {
      tenantId: tenantOid,
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

    // Cleanup overlays for this category id
    await categoryVisibilityCol().deleteMany({
      tenantId: tenantOid,
      categoryId: cat._id!,
    });

    const [remainingCategories, remainingItems] = await Promise.all([
      categoriesCol().countDocuments({ tenantId: tenantOid }),
      menuItemsCol().countDocuments({ tenantId: tenantOid }),
    ]);

    await tenantsCol().updateOne(
      { _id: tenantOid },
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

/**
 * Bulk set category visibility (per-branch, per-channel).
 * Branch sessions allowed (like items), member sessions allowed by role.
 */
export async function bulkSetCategoryVisibility(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!(canWrite(req.user?.role) || isBranch(req))) return res.fail(403, 'Forbidden');

    // NEW: optional hardExclude switch for true exclusion (tombstone)
    const { ids, visible, locationId, channel, hardExclude } = req.body as {
      ids: string[];
      visible: boolean;                 // kept for backward compatibility
      locationId?: string;
      channel?: 'dine-in' | 'online';
      hardExclude?: boolean;            // when true → write removed:true instead of visible:false
    };

    const oids = (ids || []).filter((s) => ObjectId.isValid(s)).map((s) => new ObjectId(s));
    if (!oids.length) return res.fail(400, 'No valid ids');

    const now = new Date();
    const tenantOid = new ObjectId(tenantId);
    const ch = parseChannel(channel);
    const chs = ch ? [ch] as const : (['dine-in', 'online'] as const);

    // Determine effective location (branch sessions default to their own location)
    const effectiveLocId =
      getTargetLocationId(req) ||
      (locationId && ObjectId.isValid(locationId) ? new ObjectId(locationId) : null);

    if (isBranch(req) && !effectiveLocId) {
      return res.fail(409, 'Location not set');
    }

    const writeSoftVisible = async (locIds: ObjectId[] | null) => {
      if (visible === true) {
        // remove any visible/removed overlays → baseline visible
        await categoryVisibilityCol().deleteMany({
          tenantId: tenantOid,
          categoryId: { $in: oids },
          ...(locIds ? { locationId: { $in: locIds } } : effectiveLocId ? { locationId: effectiveLocId } : {}),
          channel: { $in: chs },
        });
      } else {
        const idsToUse = locIds ?? (effectiveLocId ? [effectiveLocId] : []);
        if (idsToUse.length > 0) {
          const ops: any[] = [];
          for (const catId of oids) {
            for (const lid of idsToUse) {
              for (const c of chs) {
                ops.push({
                  updateOne: {
                    filter: { tenantId: tenantOid, categoryId: catId, locationId: lid, channel: c },
                    update: {
                      $set: { visible: false, updatedAt: now },
                      $unset: { removed: '' },
                      $setOnInsert: {
                        tenantId: tenantOid,
                        categoryId: catId,
                        locationId: lid,
                        channel: c,
                        createdAt: now,
                      },
                    },
                  upsert: true,
                  },
                });
              }
            }
          }
          if (ops.length) await categoryVisibilityCol().bulkWrite(ops, { ordered: false });
        }
      }
    };

    const writeHardExclude = async (locIds: ObjectId[] | null) => {
      const idsToUse = locIds ?? (effectiveLocId ? [effectiveLocId] : []);
      if (idsToUse.length === 0) return;
      const ops: any[] = [];
      for (const catId of oids) {
        for (const lid of idsToUse) {
          for (const c of chs) {
            ops.push({
              updateOne: {
                filter: { tenantId: tenantOid, categoryId: catId, locationId: lid, channel: c },
                update: {
                  $set: { removed: true, updatedAt: now },
                  $unset: { visible: '' },
                  $setOnInsert: {
                    tenantId: tenantOid,
                    categoryId: catId,
                    locationId: lid,
                    channel: c,
                    createdAt: now,
                  },
                },
                upsert: true,
              },
            });
          }
        }
      }
      if (ops.length) await categoryVisibilityCol().bulkWrite(ops, { ordered: false });
    };

    // Branch-specific
    if (effectiveLocId) {
      if (hardExclude === true) {
        await writeHardExclude(null);
      } else {
        // If caller explicitly sets hardExclude:false, clear tombstones first
        if (hardExclude === false) {
          await categoryVisibilityCol().updateMany(
            {
              tenantId: tenantOid,
              categoryId: { $in: oids },
              locationId: effectiveLocId,
              channel: { $in: chs },
              removed: true,
            },
            { $unset: { removed: '' }, $set: { updatedAt: now } }
          );
        }
        await writeSoftVisible(null);
      }

      const docs = await categoriesCol().find({ _id: { $in: oids }, tenantId: tenantOid }).toArray();
      await auditLog({
        userId,
        action: 'CATEGORY_BULK_VISIBILITY',
        after: docs.map(toCategoryDTO),
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      return res.ok({
        matchedCount: oids.length * chs.length,
        modifiedCount: oids.length * chs.length,
        items: docs.map(toCategoryDTO),
      });
    }

    // All locations
    const locDocs = await locationsCol().find({ tenantId: tenantOid }, { projection: { _id: 1 } }).toArray();
    const allLocIds = locDocs.map((l: any) => l._id as ObjectId);

    if (hardExclude === true) {
      await writeHardExclude(allLocIds);
    } else {
      if (hardExclude === false) {
        // clear tombstones globally for these ids/channels first
        await categoryVisibilityCol().updateMany(
          {
            tenantId: tenantOid,
            categoryId: { $in: oids },
            ...(allLocIds.length ? { locationId: { $in: allLocIds } } : {}),
            channel: { $in: chs },
            removed: true,
          },
          { $unset: { removed: '' }, $set: { updatedAt: now } }
        );
      }
      await writeSoftVisible(allLocIds);
    }

    const docs = await categoriesCol().find({ _id: { $in: oids }, tenantId: tenantOid }).toArray();

    await auditLog({
      userId,
      action: 'CATEGORY_BULK_VISIBILITY',
      after: docs.map(toCategoryDTO),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({
      matchedCount: oids.length,
      modifiedCount: oids.length,
      items: docs.map(toCategoryDTO),
    });
  } catch (err) {
    logger.error(`bulkSetCategoryVisibility error: ${(err as Error).message}`);
    next(err);
  }
}