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

    // helper to surface channel from channelScope
    const pickChannel = (cat: CategoryDoc): ('dine-in' | 'online' | undefined) => {
      const scope = (cat as any).channelScope as 'all' | 'dine-in' | 'online' | undefined;
      return scope && scope !== 'all' ? scope : undefined;
    };

    // -----------------------------
    // BRANCH VIEW
    // -----------------------------
    if (locId) {
      const visQuery: any = {
        tenantId: tenantOid,
        locationId: locId,
        categoryId: { $in: docs.map((d) => d._id!).filter(Boolean) },
      };
      if (qCh) visQuery.channel = qCh;

      const visOverlays = await categoryVisibilityCol().find(visQuery).toArray();

      const overlayByCat = new Map<string, Map<'dine-in' | 'online', boolean>>();
      const removedByCat = new Map<string, Set<'dine-in' | 'online'>>();
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
        const catKey = cat._id!.toString();

        // hard tombstone wins
        if (removedByCat.get(catKey)?.has(ch)) return false;

        const ov = overlayByCat.get(catKey)?.get(ch);
        // overlay (visible/hidden) overrides channelScope
        if (ov !== undefined) return ov;

        // baseline (no overlay): fall back to channelScope
        return channelAllowed(cat, ch);
      };

      const filtered = docs.filter((cat) => {
        if (qCh) return isVisibleInBranch(cat, qCh);
        return isVisibleInBranch(cat, 'dine-in') || isVisibleInBranch(cat, 'online');
      });

      const items = filtered.map((cat) => {
        const dto = toCategoryDTO(cat) as any;
        dto.channel = pickChannel(cat);
        return dto;
      });

      return res.ok({ items });
    }

    // -----------------------------
    // GLOBAL VIEW (ALL LOCATIONS)
    // -----------------------------
    const locDocs = await locationsCol().find({ tenantId: tenantOid }, { projection: { _id: 1 } }).toArray();
    const locIds = locDocs.map((l: any) => l._id as ObjectId);
    const locCount = locIds.length;

    const visQueryAll: any = {
      tenantId: tenantOid,
      categoryId: { $in: docs.map((d) => d._id!).filter(Boolean) },
    };
    if (locCount > 0) visQueryAll.locationId = { $in: locIds };
    if (qCh) visQueryAll.channel = qCh;

    const overlaysAll = await categoryVisibilityCol().find(visQueryAll).toArray();

    // per-cat → per-channel → per-location → visible:boolean
    const overlayByCatAll = new Map<string, Map<'dine-in' | 'online', Map<string, boolean>>>();
    // per-cat → per-channel → Set<locationId> of removed tombstones
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

    const existsAnywhereForChannel = (cat: CategoryDoc, ch: 'dine-in' | 'online'): boolean => {
      if (locCount === 0) {
        // no locations → baseline visibility by channel scope
        return channelAllowed(cat, ch);
      }

      const perChLoc = overlayByCatAll.get(cat._id!.toString())?.get(ch) ?? new Map<string, boolean>();
      const removedLocs = removedByCatAll.get(cat._id!.toString())?.get(ch) ?? new Set<string>();

      for (const lid of locIds) {
        const key = lid.toString();
        if (removedLocs.has(key)) continue; // hard removed here

        const ov = perChLoc.get(key);
        if (ov === true) return true;     // explicit include wins
        if (ov === false) continue;       // explicit hide here

        // no overlay → baseline by channel scope
        if (channelAllowed(cat, ch)) return true;
      }
      return false;
    };

    const filteredGlobal = docs.filter((cat) => {
      if (qCh) return existsAnywhereForChannel(cat, qCh);
      return existsAnywhereForChannel(cat, 'dine-in') || existsAnywhereForChannel(cat, 'online');
    });

    // ---- include/exclude summaries for GLOBAL VIEW ----
    const summarizeRestrictions = (cat: CategoryDoc) => {
      const catKey = cat._id!.toString();

      const channel = pickChannel(cat);

      const removedChMap = removedByCatAll.get(catKey);
      const excl = new Set<string>();
      if (removedChMap) {
        for (const ch of (['dine-in', 'online'] as const)) {
          const s = removedChMap.get(ch);
          if (s) for (const lid of s) excl.add(lid);
        }
      }

      const ovChMap = overlayByCatAll.get(catKey);
      const inc = new Set<string>();
      if (ovChMap) {
        for (const ch of (['dine-in', 'online'] as const)) {
          const locMap = ovChMap.get(ch);
          if (!locMap) continue;
          for (const [lid, vis] of locMap.entries()) {
            if (vis === true) inc.add(lid);
          }
        }
      }

      const hasAnyRestriction = inc.size > 0 || excl.size > 0;

      return {
        channel,
        includeLocationIds: hasAnyRestriction ? Array.from(inc) : undefined,
        excludeLocationIds: hasAnyRestriction ? Array.from(excl) : undefined,
      };
    };

    const items = filteredGlobal.map((cat) => {
      const dto = toCategoryDTO(cat) as any;
      const extra = summarizeRestrictions(cat);
      return { ...dto, ...extra };
    });

    return res.ok({ items });
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
                    $unset: { removed: "" },
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
    if (!ObjectId.isValid(id)) return res.fail(400, 'Invalid id');

    const {
      name,
      channel,                 // 'dine-in' | 'online' | 'both' | (omitted => do not change)
      includeLocationIds,      // GLOBAL overlays
      excludeLocationIds,      // GLOBAL overlays
    } = (req.body || {}) as {
      name?: string;
      channel?: 'dine-in' | 'online' | 'both';
      includeLocationIds?: string[];
      excludeLocationIds?: string[];
    };

    const channelWasExplicit = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'channel');
    const hasInclude = Array.isArray(includeLocationIds) && includeLocationIds.length > 0;
    const hasExclude = Array.isArray(excludeLocationIds) && excludeLocationIds.length > 0;

    if (name == null && !channelWasExplicit && !hasInclude && !hasExclude) {
      return res.fail(400, 'Nothing to update');
    }

    const tenantOid = new ObjectId(tenantId);
    const filter = { _id: new ObjectId(id), tenantId: tenantOid };

    const before = await categoriesCol().findOne(filter);
    if (!before) return res.fail(404, 'Category not found');

    const now = new Date();

    // --- 1) Core field updates (name + channelScope) ---
    const updateSet: Record<string, any> = { updatedAt: now };
    if (typeof name === 'string') updateSet.name = String(name || '').trim();

    const prevScope = ((before as any).channelScope as 'all' | 'dine-in' | 'online' | undefined) ?? 'all';
    let nextScope = prevScope;

    if (channelWasExplicit) {
      if (channel === 'dine-in' || channel === 'online') {
        nextScope = channel;
      } else {
        // 'both' (or nullish) ⇒ 'all'
        nextScope = 'all';
      }
      updateSet.channelScope = nextScope;
    }

    // 1a) If category is branch-scoped and caller provided include/exclude,
    //     promote category to GLOBAL so overlays make sense.
    const wasBranchScoped = (before as any).scope === 'location';
    if (wasBranchScoped && (hasInclude || hasExclude)) {
      updateSet.scope = 'all';
      updateSet.locationId = null;
    }

    await categoriesCol().updateOne(filter, { $set: updateSet });

    // Re-read updated document
    const doc = await categoriesCol().findOne(filter);
    if (!doc) return res.fail(404, 'Category not found');

    // --- 1b) If single-channel → BOTH, clear tombstones on the newly-added channel ---
    // Previously this only ran when includeLocationIds was provided. Now, if none is
    // provided, we clear across ALL tenant locations so the category truly becomes visible.
    if (prevScope !== 'all' && nextScope === 'all') {
      const newlyIncluded: 'dine-in' | 'online' = prevScope === 'dine-in' ? 'online' : 'dine-in';

      // build list of lids to clear
      let lidsToClear: ObjectId[] = [];

      if (hasInclude) {
        lidsToClear = (includeLocationIds ?? [])
          .filter(Boolean)
          .filter((s) => ObjectId.isValid(s))
          .map((s) => new ObjectId(s));

        if (lidsToClear.length) {
          // ensure they belong to tenant
          const allowedSet = new Set(
            (
              await locationsCol()
                .find({ _id: { $in: lidsToClear }, tenantId: tenantOid }, { projection: { _id: 1 } })
                .toArray()
            ).map((l: any) => l._id.toString())
          );
          lidsToClear = lidsToClear.filter((oid) => allowedSet.has(oid.toString()));
        }
      } else {
        // ❗ No include list given → clear tombstones on newly-added channel for ALL tenant locations
        const allLocs = await locationsCol()
          .find({ tenantId: tenantOid }, { projection: { _id: 1 } })
          .toArray();
        lidsToClear = allLocs.map((l: any) => l._id as ObjectId);
      }

      if (lidsToClear.length) {
        await categoryVisibilityCol().updateMany(
          {
            tenantId: tenantOid,
            categoryId: doc._id!,
            channel: newlyIncluded,
            locationId: { $in: lidsToClear },
            removed: true,
          },
          { $unset: { removed: '' }, $set: { updatedAt: now } }
        );
      }
      // NOTE: we intentionally do NOT auto-write visible:true overlays here;
      // clearing the tombstone reverts to baseline visible on that channel.
    }

    // --- 2) Per-location overlays (GLOBAL categories only) ---
    const isGlobalNow = (doc as any).scope !== 'location';

    if (isGlobalNow && (hasInclude || hasExclude)) {
      const toOids = (ids?: string[]) =>
        (ids ?? [])
          .filter(Boolean)
          .filter((s) => ObjectId.isValid(s))
          .map((s) => new ObjectId(s));

      const rawIds = [...toOids(includeLocationIds), ...toOids(excludeLocationIds)];
      const allowed = new Set(
        (
          await locationsCol()
            .find({ _id: { $in: rawIds }, tenantId: tenantOid }, { projection: { _id: 1 } })
            .toArray()
        ).map((l: any) => l._id.toString())
      );

      const includeIds = hasInclude ? toOids(includeLocationIds).filter((oid) => allowed.has(oid.toString())) : [];
      const excludeIds = hasExclude ? toOids(excludeLocationIds).filter((oid) => allowed.has(oid.toString())) : [];

      // Seed channel overlays: if caller set a single channel, use it; else both.
      const seedChannels: Array<'dine-in' | 'online'> =
        channelWasExplicit && (channel === 'dine-in' || channel === 'online')
          ? [channel]
          : (['dine-in', 'online'] as const);

      const ops: any[] = [];

      // include → visible:true (clear any tombstone)
      for (const lid of includeIds) {
        for (const c of seedChannels) {
          ops.push({
            updateOne: {
              filter: { tenantId: tenantOid, categoryId: doc._id!, locationId: lid, channel: c },
              update: {
                $set: { visible: true, updatedAt: now },
                $unset: { removed: '' },
                $setOnInsert: {
                  tenantId: tenantOid,
                  categoryId: doc._id!,
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

      // exclude → removed:true (clear visible)
      for (const lid of excludeIds) {
        for (const c of seedChannels) {
          ops.push({
            updateOne: {
              filter: { tenantId: tenantOid, categoryId: doc._id!, locationId: lid, channel: c },
              update: {
                $set: { removed: true, updatedAt: now },
                $unset: { visible: '' },
                $setOnInsert: {
                  tenantId: tenantOid,
                  categoryId: doc._id!,
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

      if (ops.length) {
        await categoryVisibilityCol().bulkWrite(ops, { ordered: false });
      }
    }

    // --- 3) Audit + respond ---
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

    // ✅ support legacy docs that only stored category name
    const catMatch = { $or: [{ categoryId: cat._id }, { category: cat.name }] as any[] };

    const availability = client.db('authDB').collection('itemAvailability');

    // helper
    const cleanupItemOverlays = async (itemIds: ObjectId[]) => {
      if (!itemIds.length) return;
      await availability.deleteMany({ tenantId: tenantOid, itemId: { $in: itemIds } });
    };

    // -------- Location + Channel
    if (qLoc && ObjectId.isValid(qLoc) && qCh) {
      const locId = new ObjectId(qLoc);
      const key = qCh === 'dine-in' ? 'visibility.dineIn' : 'visibility.online';
      const otherKey = qCh === 'dine-in' ? 'visibility.online' : 'visibility.dineIn';

      // Items that belong only to this location
      const branchItems = await menuItemsCol()
        .find({ tenantId: tenantOid, ...catMatch, locationId: locId })
        .toArray();

      // Items that are global (show in all locations)
      const globalItems = await menuItemsCol()
        .find({
          tenantId: tenantOid,
          ...catMatch,
          $or: [{ locationId: { $exists: false } }, { locationId: null }],
        })
        .toArray();

      // For branch-scoped items: if other channel is ON → just turn OFF this channel.
      // If other channel is OFF → hard delete.
      const toHardDelete: ObjectId[] = [];
      const visUpdates: any[] = [];
      const overlayDeletes: any[] = [];

      for (const it of branchItems as any[]) {
        const vis = it.visibility || {};
        const otherOn = vis[otherKey] === true;
        if (otherOn) {
          visUpdates.push({
            updateOne: {
              filter: { _id: it._id, tenantId: tenantOid },
              update: {
                $set: { [key]: false, updatedAt: now, updatedBy: new ObjectId(userId) },
              },
            },
          });
          // remove any local overlays for this channel (so baseline OFF wins)
          overlayDeletes.push({
            deleteMany: {
              filter: { tenantId: tenantOid, itemId: it._id, locationId: locId, channel: qCh },
            },
          });
        } else {
          toHardDelete.push(it._id as ObjectId);
        }
      }

      if (visUpdates.length) await menuItemsCol().bulkWrite(visUpdates, { ordered: false });
      if (overlayDeletes.length) await availability.bulkWrite(overlayDeletes, { ordered: false });

      if (toHardDelete.length) {
        await menuItemsCol().deleteMany({ _id: { $in: toHardDelete }, tenantId: tenantOid });
        await availability.deleteMany({
          tenantId: tenantOid,
          itemId: { $in: toHardDelete },
          locationId: locId,
          channel: qCh,
        });
      }

      // For global items: stamp per-location+channel tombstones so they disappear only here
      if (globalItems.length) {
        const ops = globalItems.map((it: any) => ({
          updateOne: {
            filter: { tenantId: tenantOid, itemId: it._id, locationId: locId, channel: qCh },
            update: {
              $set: { removed: true, updatedAt: now },
              $setOnInsert: {
                tenantId: tenantOid,
                itemId: it._id,
                locationId: locId,
                channel: qCh,
                createdAt: now,
              },
            },
            upsert: true,
          },
        }));
        await availability.bulkWrite(ops, { ordered: false });
      }

      // Mark the category removed in this location+channel
      await categoryVisibilityCol().updateOne(
        { tenantId: tenantOid, categoryId: cat._id!, locationId: locId, channel: qCh },
        {
          $set: { removed: true, updatedAt: now },
          $unset: { visible: '' as '' },
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

      const affected = branchItems.length + globalItems.length;

      await auditLog({
        userId,
        action: 'CATEGORY_DELETE',
        before: toCategoryDTO(cat),
        metadata: { deletedProducts: affected },
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      return res.ok({ deleted: true, deletedProducts: affected });
    }

    // -------- Location only (all channels in that location)
    if (qLoc && ObjectId.isValid(qLoc) && !qCh) {
      const locId = new ObjectId(qLoc);

      const branchItems = await menuItemsCol()
        .find({ tenantId: tenantOid, ...catMatch, locationId: locId })
        .toArray();

      const globalItems = await menuItemsCol()
        .find({
          tenantId: tenantOid,
          ...catMatch,
          $or: [{ locationId: { $exists: false } }, { locationId: null }],
        })
        .toArray();

      // Branch-scoped: hard delete (both channels are local to this branch)
      const delIds = branchItems.map((i) => i._id as ObjectId);
      if (delIds.length) {
        await menuItemsCol().deleteMany({ _id: { $in: delIds }, tenantId: tenantOid });
        await availability.deleteMany({ tenantId: tenantOid, itemId: { $in: delIds }, locationId: locId });
      }

      // Global: tombstone both channels for this location
      if (globalItems.length) {
        const ops = (['dine-in', 'online'] as const).flatMap((c) =>
          globalItems.map((it: any) => ({
            updateOne: {
              filter: { tenantId: tenantOid, itemId: it._id, locationId: locId, channel: c },
              update: {
                $set: { removed: true, updatedAt: now },
                $setOnInsert: {
                  tenantId: tenantOid,
                  itemId: it._id,
                  locationId: locId,
                  channel: c,
                  createdAt: now,
                },
              },
              upsert: true,
            },
          }))
        );
        await availability.bulkWrite(ops, { ordered: false });
      }

      // Keep your category tombstones as before
      const visOps = (['dine-in', 'online'] as const).map((c) => ({
        updateOne: {
          filter: { tenantId: tenantOid, categoryId: cat._id!, locationId: locId, channel: c },
          update: {
            $set: { removed: true, updatedAt: now },
            $unset: { visible: '' as '' },
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
      }));
      await categoryVisibilityCol().bulkWrite(visOps, { ordered: false });

      const affected = branchItems.length + globalItems.length;

      await auditLog({
        userId,
        action: 'CATEGORY_DELETE',
        before: toCategoryDTO(cat),
        metadata: { deletedProducts: affected },
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      return res.ok({ deleted: true, deletedProducts: affected });
    }

    // -------- Channel only (all locations for that channel)
    if (!qLoc && qCh) {
      // Keep your original behavior (tenant-wide removal for that channel)
      const items = await menuItemsCol()
        .find({ tenantId: tenantOid, ...catMatch })
        .toArray();

      if (items.length) {
        const ids = items.map((i) => i._id as ObjectId);
        await menuItemsCol().deleteMany({ _id: { $in: ids }, tenantId: tenantOid });
        await cleanupItemOverlays(ids);
      }

      await categoryVisibilityCol().deleteMany({
        tenantId: tenantOid,
        categoryId: cat._id!,
        channel: qCh,
      });

      await categoriesCol().updateOne(filter, {
        $set: { channelScope: qCh === 'dine-in' ? 'online' : 'dine-in', updatedAt: now },
      });

      await auditLog({
        userId,
        action: 'CATEGORY_DELETE',
        before: toCategoryDTO(cat),
        metadata: { deletedProducts: items.length },
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      return res.ok({ deleted: true, deletedProducts: items.length });
    }

    // -------- Global delete (all items everywhere)
    const allItems = await menuItemsCol().find({ tenantId: tenantOid, ...catMatch }).toArray();
    const allIds = allItems.map((i) => i._id as ObjectId);

    if (allIds.length) {
      await menuItemsCol().deleteMany({ _id: { $in: allIds }, tenantId: tenantOid });
      await cleanupItemOverlays(allIds);
    }

    await categoriesCol().deleteOne(filter);
    await categoryVisibilityCol().deleteMany({ tenantId: tenantOid, categoryId: cat._id! });

    await auditLog({
      userId,
      action: 'CATEGORY_DELETE',
      before: toCategoryDTO(cat),
      metadata: { deletedProducts: allIds.length },
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ deleted: true, deletedProducts: allIds.length });
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

    const { ids, visible, locationId, channel, hardExclude } = req.body as {
      ids: string[];
      visible: boolean;
      locationId?: string;
      channel?: 'dine-in' | 'online';
      hardExclude?: boolean;
    };

    const oids = (ids || []).filter((s) => ObjectId.isValid(s)).map((s) => new ObjectId(s));
    if (!oids.length) return res.fail(400, 'No valid ids');

    const now = new Date();
    const tenantOid = new ObjectId(tenantId);
    const ch = parseChannel(channel);
    const chs = ch ? [ch] as const : (['dine-in', 'online'] as const);

    const effectiveLocId =
      getTargetLocationId(req) ||
      (locationId && ObjectId.isValid(locationId) ? new ObjectId(locationId) : null);

    if (isBranch(req) && !effectiveLocId) {
      return res.fail(409, 'Location not set');
    }

    // --- helpers ---
    const writeSoftVisible = async (locIds: ObjectId[] | null) => {
      if (visible === true) {
        const filterBase = {
          tenantId: tenantOid,
          categoryId: { $in: oids },
          channel: { $in: chs },
        } as any;
        if (locIds) filterBase.locationId = { $in: locIds };
        else if (effectiveLocId) filterBase.locationId = effectiveLocId;

        // ✅ Clear tombstones when turning visible again
        await categoryVisibilityCol().updateMany(
          { ...filterBase, removed: true },
          { $unset: { removed: '' }, $set: { updatedAt: now } }
        );

        // ✅ Remove any soft visibility overrides so baseline (visible) applies
        await categoryVisibilityCol().deleteMany(filterBase);
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

    // --- branch-specific ---
    if (effectiveLocId) {
      if (hardExclude === true) {
        await writeHardExclude(null);
      } else {
        // ✅ Clear tombstones first if visible turned true OR hardExclude explicitly false
        if (visible === true || hardExclude === false) {
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

      const docs = await categoriesCol()
        .find({ _id: { $in: oids }, tenantId: tenantOid })
        .toArray();

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

    // --- all locations ---
    const locDocs = await locationsCol()
      .find({ tenantId: tenantOid }, { projection: { _id: 1 } })
      .toArray();
    const allLocIds = locDocs.map((l: any) => l._id as ObjectId);

    if (hardExclude === true) {
      await writeHardExclude(allLocIds);
    } else {
      // ✅ same restore logic globally
      if (visible === true || hardExclude === false) {
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

    const docs = await categoriesCol()
      .find({ _id: { $in: oids }, tenantId: tenantOid })
      .toArray();

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
