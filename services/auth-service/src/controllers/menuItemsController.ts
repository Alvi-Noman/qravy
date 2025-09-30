import type { Request, Response, NextFunction } from 'express';
import { ObjectId, type AnyBulkWriteOperation } from 'mongodb';
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
function locationsCol() {
  return client.db('authDB').collection('locations');
}

function canWrite(role?: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}
function isBranch(req: Request): boolean {
  return !req.user?.role; // device/branch session has no membership role
}

const CHANNELS: Array<'dine-in' | 'online'> = ['dine-in', 'online'];
function parseChannel(v: unknown): 'dine-in' | 'online' | undefined {
  return v === 'dine-in' || v === 'online' ? v : undefined;
}
function visKey(ch: 'dine-in' | 'online'): 'dineIn' | 'online' {
  return ch === 'dine-in' ? 'dineIn' : 'online';
}

function baseVisible(doc: MenuItemDoc, ch: 'dine-in' | 'online'): boolean {
  const k = visKey(ch);
  const v = doc.visibility?.[k as 'dineIn' | 'online'];
  return typeof v === 'boolean' ? v : true;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

type VariationDTO = Pick<Variation, 'name'> & Partial<Variation>;
function normalizeVariations(list: unknown): VariationDTO[] {
  const arr = Array.isArray(list) ? list : [];
  const out: VariationDTO[] = [];
  for (const raw of arr) {
    const r = raw as Record<string, unknown>;
    const name = typeof r?.name === 'string' ? (r.name as string).trim() : '';
    if (!name) continue;

    let price: number | undefined;
    if (typeof r?.price === 'number') {
      price = r.price as number;
    } else if (typeof r?.price === 'string') {
      const n = Number(r.price as string);
      if (Number.isFinite(n)) price = n;
    }

    const imageUrl =
      typeof r?.imageUrl === 'string' && (r.imageUrl as string).trim()
        ? (r.imageUrl as string)
        : undefined;

    const v: any = { name };
    if (price !== undefined && price >= 0) v.price = price;
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
    const qCh = parseChannel(req.query.channel);
    const tenantOid = new ObjectId(tenantId);

    const baseFilter: any = { tenantId: tenantOid };

    const mark = (available: boolean, dto: ReturnType<typeof toMenuItemDTO>) => {
      dto.hidden = !available;
      dto.status = available ? 'active' : 'hidden';
      return dto;
    };

    // Branch view: global + that branch, overlay applied.
    if (qLoc && ObjectId.isValid(qLoc)) {
      const locId = new ObjectId(qLoc);
      const filter = {
        ...baseFilter,
        $or: [{ locationId: { $exists: false } }, { locationId: null }, { locationId: locId }],
      };
      const docs = await col().find(filter).sort({ createdAt: -1 }).toArray();
      if (docs.length === 0) return res.ok({ items: [] });

      // Load overlays for this location (availability + removal tombstones)
      const overlayQuery: any = {
        tenantId: tenantOid,
        locationId: locId,
        itemId: { $in: docs.map((d) => d._id!).filter(Boolean) },
      };
      if (qCh) overlayQuery.channel = qCh;

      const overlays = await availabilityCol().find(overlayQuery).toArray();
      const overlayByItem = new Map<string, Map<'dine-in' | 'online', boolean>>();
      const removedByItem = new Map<string, Set<'dine-in' | 'online'>>();
      for (const o of overlays as any[]) {
        const itemKey = o.itemId.toString();
        const ch = o.channel as 'dine-in' | 'online';
        if (o.removed === true) {
          const set = removedByItem.get(itemKey) ?? new Set();
          set.add(ch);
          removedByItem.set(itemKey, set);
        } else {
          const m = overlayByItem.get(itemKey) ?? new Map();
          m.set(ch, !!o.available);
          overlayByItem.set(itemKey, m);
        }
      }

      const items: ReturnType<typeof toMenuItemDTO>[] = [];
      for (const d of docs) {
        const dto = toMenuItemDTO(d);
        const itmKey = d._id!.toString();
        const removedSet = removedByItem.get(itmKey);

        if (qCh) {
          // Scoped delete (tombstone) wins: skip entirely if removed for this channel in this location
          if (removedSet?.has(qCh)) continue;

          // Single-channel branch view: respect baseline channel-exclusion, but allow overlay to enable it.
          const baseline = baseVisible(d, qCh);
          const ov = overlayByItem.get(itmKey)?.get(qCh);
          if (!baseline && ov !== true) continue; // excluded and no override => skip
          const finalAvail = ov !== undefined ? ov : baseline;
          items.push(mark(finalAvail, dto));
        } else {
          // All-channels branch view: if removed for both channels in this location, skip
          const fullyRemoved =
            removedSet && CHANNELS.every((c) => removedSet.has(c));
          if (fullyRemoved) continue;

          // Include, reflect aggregated availability
          let availableAny = false;
          for (const ch of CHANNELS) {
            const baseline = baseVisible(d, ch);
            const ov = overlayByItem.get(itmKey)?.get(ch);
            const finalAvail = ov !== undefined ? ov : baseline;
            if (finalAvail) {
              availableAny = true;
              break;
            }
          }
          items.push(mark(availableAny, dto));
        }
      }

      return res.ok({ items });
    }

    // "All locations" view
    const docs = await col().find(baseFilter).sort({ createdAt: -1 }).toArray();
    if (docs.length === 0) return res.ok({ items: [] });

    // Get all tenant locations
    const locDocs = await locationsCol()
      .find({ tenantId: tenantOid }, { projection: { _id: 1 } })
      .toArray();
    const locIds = locDocs.map((l: any) => l._id as ObjectId);
    const locCount = locIds.length;

    // Gather overlays across all locations (for single channel or both)
    const overlayQueryAll: any = {
      tenantId: tenantOid,
      itemId: { $in: docs.map((d) => d._id!).filter(Boolean) },
    };
    if (locCount > 0) overlayQueryAll.locationId = { $in: locIds };
    if (qCh) overlayQueryAll.channel = qCh;

    const overlaysAll = await availabilityCol().find(overlayQueryAll).toArray();

    // availability overlays by item->channel->loc: boolean
    const overlayByItemAll = new Map<string, Map<'dine-in' | 'online', Map<string, boolean>>>();
    // removal tombstones by item->channel->Set<locId>
    const removedByItemAll = new Map<string, Map<'dine-in' | 'online', Set<string>>>();

    for (const o of overlaysAll as any[]) {
      const itemKey = o.itemId.toString();
      const ch = o.channel as 'dine-in' | 'online';
      const locKey = o.locationId.toString();
      if (o.removed === true) {
        const chMap = removedByItemAll.get(itemKey) ?? new Map();
        const set = chMap.get(ch) ?? new Set<string>();
        set.add(locKey);
        chMap.set(ch, set);
        removedByItemAll.set(itemKey, chMap);
      } else {
        const chMap = overlayByItemAll.get(itemKey) ?? new Map();
        const locMap = chMap.get(ch) ?? new Map<string, boolean>();
        locMap.set(locKey, !!o.available);
        chMap.set(ch, locMap);
        overlayByItemAll.set(itemKey, chMap);
      }
    }

    const items = docs
      .map((d) => {
        const dto = toMenuItemDTO(d);
        const itmKey = d._id!.toString();

        const channelsToEval = qCh ? [qCh] : CHANNELS;

        const availForChannel = (ch: 'dine-in' | 'online'): boolean => {
          const baseline = baseVisible(d, ch);
          if (locCount === 0) return baseline;

          const perChLoc = overlayByItemAll.get(itmKey)?.get(ch) ?? new Map<string, boolean>();
          const removedLocs = removedByItemAll.get(itmKey)?.get(ch) ?? new Set<string>();

          if (d.locationId) {
            // Branch-only item: evaluate only its own branch
            const k = (d.locationId as ObjectId).toString();
            if (removedLocs.has(k)) return false; // tombstoned in that branch+channel
            const ov = perChLoc.get(k);
            return ov !== undefined ? ov : baseline;
          }

          // Global item across all locations for this channel:
          // presence if any location is not removed AND evaluates true (baseline or overlay).
          for (const lid of locIds) {
            const key = lid.toString();
            if (removedLocs.has(key)) continue; // removed in this loc+ch
            const ov = perChLoc.get(key);
            const final = ov !== undefined ? ov : baseline;
            if (final) return true;
          }
          return false;
        };

        // If a single channel is requested, hide items excluded by baseline unless any location enables them.
        if (qCh) {
          const baseline = baseVisible(d, qCh);
          const perChLoc = overlayByItemAll.get(itmKey)?.get(qCh) ?? new Map<string, boolean>();
          const removedLocs = removedByItemAll.get(itmKey)?.get(qCh) ?? new Set<string>();
          const anyEnabled = Array.from(perChLoc.entries()).some(
            ([locKey, val]) => val === true && !removedLocs.has(locKey)
          );
          if (!baseline && !anyEnabled) return null;
        }

        // Aggregate availability for requested channels (used to set hidden/status)
        let availableAny = false;
        for (const ch of channelsToEval) {
          if (availForChannel(ch)) {
            availableAny = true;
            break;
          }
        }

        return mark(availableAny, dto);
      })
      .filter(Boolean) as ReturnType<typeof toMenuItemDTO>[];

    return res.ok({ items });
  } catch (err) {
    logger.error(`listMenuItems error: ${(err as Error).message}`);
    next(err);
  }
}

// createMenuItem, updateMenuItem, deleteMenuItem, bulkSetAvailability, bulkDeleteMenuItems, bulkChangeCategory
// (unchanged in behavior; typed ops added)

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
      locationId?: string;
      channel?: 'dine-in' | 'online';
      includeLocationIds?: string[];
      excludeLocationIds?: string[];
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

    const isBranchScoped = body.locationId && ObjectId.isValid(body.locationId);
    if (isBranchScoped) {
      doc.locationId = new ObjectId(body.locationId!);
      doc.scope = 'location';
    } else {
      doc.scope = 'all';
      doc.locationId = null;
    }

    const ch = parseChannel(body.channel);
    if (ch) {
      doc.visibility = {
        dineIn: ch === 'dine-in',
        online: ch === 'online',
      };
    } else {
      doc.visibility = { dineIn: true, online: true };
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

    let includeIds: ObjectId[] = [];
    let excludeIds: ObjectId[] = [];
    const seedChs: Array<'dine-in' | 'online'> = ch ? [ch] : CHANNELS;

    if (!isBranchScoped) {
      const rawInclude = Array.isArray(body.includeLocationIds) ? body.includeLocationIds : [];
      const rawExclude = Array.isArray(body.excludeLocationIds) ? body.excludeLocationIds : [];

      const validInclude = rawInclude
        .filter((s) => typeof s === 'string' && ObjectId.isValid(s))
        .map((s) => new ObjectId(s));
      const validExclude = rawExclude
        .filter((s) => typeof s === 'string' && ObjectId.isValid(s))
        .map((s) => new ObjectId(s));

      if (validInclude.length || validExclude.length) {
        const wanted = [...validInclude, ...validExclude];
        const locs = await locationsCol()
          .find({ _id: { $in: wanted }, tenantId: new ObjectId(tenantId) }, { projection: { _id: 1 } })
          .toArray();
        const allowed = new Set(locs.map((l: any) => (l._id as ObjectId).toString()));
        includeIds = validInclude.filter((id) => allowed.has(id.toString()));
        excludeIds = validExclude.filter((id) => allowed.has(id.toString()));

        if (includeIds.length) {
          for (const c of seedChs) {
            const key = visKey(c);
            doc.visibility[key] = false;
          }
        }
      }
    }

    const result = await col().insertOne(doc);
    const created: MenuItemDoc = { ...doc, _id: result.insertedId };

    if (!isBranchScoped) {
      const ops: AnyBulkWriteOperation<ItemAvailabilityDoc>[] = [];
      if (includeIds.length) {
        for (const lid of includeIds) {
          for (const c of seedChs) {
            ops.push({
              updateOne: {
                filter: {
                  tenantId: new ObjectId(tenantId),
                  itemId: created._id,
                  locationId: lid,
                  channel: c,
                },
                update: {
                  $set: { available: true, removed: false, updatedAt: now },
                  $setOnInsert: {
                    tenantId: new ObjectId(tenantId),
                    itemId: created._id,
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
        for (const lid of excludeIds) {
          for (const c of CHANNELS) {
            ops.push({
              updateOne: {
                filter: {
                  tenantId: new ObjectId(tenantId),
                  itemId: created._id,
                  locationId: lid,
                  channel: c,
                },
                update: {
                  $set: { removed: true, updatedAt: now },
                  $setOnInsert: {
                    tenantId: new ObjectId(tenantId),
                    itemId: created._id,
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
      if (ops.length) await availabilityCol().bulkWrite(ops, { ordered: false });
    }

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

    const tenantOid = new ObjectId(tenantId);
    const item = await col().findOne({ _id: new ObjectId(id), tenantId: tenantOid });
    if (!item) return res.fail(404, 'Item not found');

    const qLoc = typeof req.query.locationId === 'string' ? req.query.locationId : undefined;
    const qCh = parseChannel(req.query.channel);
    const now = new Date();

    // Location + Channel: remove only that location+channel
    if (qLoc && ObjectId.isValid(qLoc) && qCh) {
      const locId = new ObjectId(qLoc);

      if (item.locationId && (item.locationId as ObjectId).toString() === locId.toString()) {
        // Branch-scoped item: turn off this channel baseline for this doc
        const key = visKey(qCh);
        await col().updateOne(
          { _id: item._id, tenantId: tenantOid },
          { $set: { [`visibility.${key}`]: false, updatedAt: now, updatedBy: new ObjectId(userId) } }
        );
        // Remove any overlay that might bring it back for this location+channel
        await availabilityCol().deleteMany({
          tenantId: tenantOid,
          itemId: item._id!,
          locationId: locId,
          channel: qCh,
        });
      } else {
        // Global item: write a per-location+channel tombstone (removed)
        await availabilityCol().updateOne(
          { tenantId: tenantOid, itemId: item._id!, locationId: locId, channel: qCh },
          {
            $set: { removed: true, updatedAt: now },
            $setOnInsert: {
              tenantId: tenantOid,
              itemId: item._id!,
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
        action: 'MENU_ITEM_DELETE',
        before: toMenuItemDTO(item),
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });
      return res.ok({ deleted: true });
    }

    // Location only: remove from that location (both channels)
    if (qLoc && ObjectId.isValid(qLoc) && !qCh) {
      const locId = new ObjectId(qLoc);

      if (item.locationId && (item.locationId as ObjectId).toString() === locId.toString()) {
        // Branch-scoped item: hard delete this doc
        const deleted = await col().findOneAndDelete(
          { _id: item._id, tenantId: tenantOid },
          { includeResultMetadata: false }
        );
        // Cleanup overlays for this item/location
        await availabilityCol().deleteMany({
          tenantId: tenantOid,
          itemId: item._id!,
          locationId: locId,
        });

        await auditLog({
          userId,
          action: 'MENU_ITEM_DELETE',
          before: toMenuItemDTO(deleted!),
          ip: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });

        const remaining = await col().countDocuments({ tenantId: tenantOid });
        await tenantsCol().updateOne(
          { _id: tenantOid },
          { $set: { 'onboardingProgress.hasMenuItem': remaining > 0, updatedAt: new Date() } }
        );

        return res.ok({ deleted: true });
      } else {
        // Global item: write location tombstones for both channels
        const ops: AnyBulkWriteOperation<ItemAvailabilityDoc>[] = [];
        for (const ch of CHANNELS) {
          ops.push({
            updateOne: {
              filter: { tenantId: tenantOid, itemId: item._id!, locationId: locId, channel: ch },
              update: {
                $set: { removed: true, updatedAt: now },
                $setOnInsert: {
                  tenantId: tenantOid,
                  itemId: item._id!,
                  locationId: locId,
                  channel: ch,
                  createdAt: now,
                },
              },
              upsert: true,
            },
          });
        }
        if (ops.length) await availabilityCol().bulkWrite(ops, { ordered: false });

        await auditLog({
          userId,
          action: 'MENU_ITEM_DELETE',
          before: toMenuItemDTO(item),
          ip: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });

        return res.ok({ deleted: true });
      }
    }

    // Channel only: remove from this channel across all locations
    if (!qLoc && qCh) {
      const key = visKey(qCh);
      await col().updateOne(
        { _id: item._id, tenantId: tenantOid },
        { $set: { [`visibility.${key}`]: false, updatedAt: now, updatedBy: new ObjectId(userId) } }
      );
      // Remove any overlays for this channel across all locations
      await availabilityCol().deleteMany({
        tenantId: tenantOid,
        itemId: item._id!,
        channel: qCh,
      });

      await auditLog({
        userId,
        action: 'MENU_ITEM_DELETE',
        before: toMenuItemDTO(item),
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      return res.ok({ deleted: true });
    }

    // No scope: hard delete everywhere + cleanup overlays
    const deleted = await col().findOneAndDelete(
      { _id: new ObjectId(id), tenantId: tenantOid },
      { includeResultMetadata: false }
    );
    if (!deleted) return res.fail(404, 'Item not found');

    await availabilityCol().deleteMany({
      tenantId: tenantOid,
      itemId: new ObjectId(id),
    });

    await auditLog({
      userId,
      action: 'MENU_ITEM_DELETE',
      before: toMenuItemDTO(deleted),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    const remaining = await col().countDocuments({ tenantId: tenantOid });
    await tenantsCol().updateOne(
      { _id: tenantOid },
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

    if (!(canWrite(req.user?.role) || isBranch(req))) return res.fail(403, 'Forbidden');

    const { ids, active, locationId, channel } = req.body as {
      ids: string[];
      active: boolean;
      locationId?: string;
      channel?: 'dine-in' | 'online';
    };
    const oids = (ids || []).filter((s) => ObjectId.isValid(s)).map((s) => new ObjectId(s));
    if (!oids.length) return res.fail(400, 'No valid ids');

    const now = new Date();
    const chs = channel ? [channel] : CHANNELS;

    if (locationId && ObjectId.isValid(locationId)) {
      const locId = new ObjectId(locationId);

      const ops: AnyBulkWriteOperation<ItemAvailabilityDoc>[] = [];
      for (const ch of chs) {
        for (const itemId of oids) {
          ops.push({
            updateOne: {
              filter: { tenantId: new ObjectId(tenantId), itemId, locationId: locId, channel: ch },
              update: {
                $set: { available: !!active, removed: false, updatedAt: now },
                $setOnInsert: {
                  tenantId: new ObjectId(tenantId),
                  itemId,
                  locationId: locId,
                  channel: ch,
                  createdAt: now,
                },
              },
              upsert: true,
            },
          });
        }
      }
      if (ops.length) await availabilityCol().bulkWrite(ops, { ordered: false });

      const docs = await col().find({ _id: { $in: oids }, tenantId: new ObjectId(tenantId) }).toArray();
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

      return res.ok({ matchedCount: oids.length * chs.length, modifiedCount: oids.length * chs.length, items });
    }

    const locDocs = await locationsCol()
      .find({ tenantId: new ObjectId(tenantId) }, { projection: { _id: 1 } })
      .toArray();
    const locIds = locDocs.map((l: any) => l._id as ObjectId);

    if (active === true) {
      await availabilityCol().deleteMany({
        tenantId: new ObjectId(tenantId),
        itemId: { $in: oids },
        ...(locIds.length ? { locationId: { $in: locIds } } : {}),
        channel: { $in: chs },
      });
      // Do not change baseline visibility here
    } else {
      if (locIds.length > 0) {
        const ops: AnyBulkWriteOperation<ItemAvailabilityDoc>[] = [];
        for (const itemId of oids) {
          for (const lid of locIds) {
            for (const ch of chs) {
              ops.push({
                updateOne: {
                  filter: { tenantId: new ObjectId(tenantId), itemId, locationId: lid, channel: ch },
                  update: {
                    $set: { available: false, removed: false, updatedAt: now },
                    $setOnInsert: {
                      tenantId: new ObjectId(tenantId),
                      itemId,
                      locationId: lid,
                      channel: ch,
                      createdAt: now,
                    },
                  },
                  upsert: true,
                },
              });
            }
          }
        }
        if (ops.length) await availabilityCol().bulkWrite(ops, { ordered: false });
      }
      // Do not change baseline visibility here
    }

    const docs = await col().find({ _id: { $in: oids }, tenantId: new ObjectId(tenantId) }).toArray();
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
      matchedCount: docs.length,
      modifiedCount: docs.length,
      items,
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

    const body = req.body as { ids: string[]; locationId?: string; channel?: 'dine-in' | 'online' };
    const { ids, locationId, channel } = body;
    const oids = (ids || []).filter((s) => ObjectId.isValid(s)).map((s) => new ObjectId(s));
    if (!oids.length) return res.fail(400, 'No valid ids');

    const tenantOid = new ObjectId(tenantId);
    const docs = await col().find({ _id: { $in: oids }, tenantId: tenantOid }).toArray();
    const now = new Date();

    let hardDeleteIds: ObjectId[] = [];
    const perLocRemovals: AnyBulkWriteOperation<ItemAvailabilityDoc>[] = [];
    const perLocChRemovals: AnyBulkWriteOperation<ItemAvailabilityDoc>[] = [];
    const channelVisibilityUpdates: AnyBulkWriteOperation<MenuItemDoc>[] = [];
    const deleteOverlaysFilters: any[] = [];

    // Determine scope
    const hasLoc = locationId && ObjectId.isValid(locationId);
    const locId = hasLoc ? new ObjectId(locationId as string) : undefined;
    const ch = parseChannel(channel);

    for (const d of docs) {
      // Location + Channel
      if (hasLoc && ch) {
        if (d.locationId && (d.locationId as ObjectId).toString() === (locId as ObjectId).toString()) {
          // Branch-scoped: set visibility false for that channel
          const key = visKey(ch);
          channelVisibilityUpdates.push({
            updateOne: {
              filter: { _id: d._id, tenantId: tenantOid },
              update: { $set: { [`visibility.${key}`]: false, updatedAt: now, updatedBy: new ObjectId(userId) } },
            },
          });
          deleteOverlaysFilters.push({ tenantId: tenantOid, itemId: d._id!, locationId: locId, channel: ch });
        } else {
          // Global: per-location+channel tombstone
          perLocChRemovals.push({
            updateOne: {
              filter: { tenantId: tenantOid, itemId: d._id!, locationId: locId, channel: ch },
              update: {
                $set: { removed: true, updatedAt: now },
                $setOnInsert: {
                  tenantId: tenantOid,
                  itemId: d._id!,
                  locationId: locId!,
                  channel: ch,
                  createdAt: now,
                },
              },
              upsert: true,
            },
          });
        }
        continue;
      }

      // Location only
      if (hasLoc && !ch) {
        if (d.locationId && (d.locationId as ObjectId).toString() === (locId as ObjectId).toString()) {
          hardDeleteIds.push(d._id!);
        } else {
          for (const c of CHANNELS) {
            perLocRemovals.push({
              updateOne: {
                filter: { tenantId: tenantOid, itemId: d._id!, locationId: locId!, channel: c },
                update: {
                  $set: { removed: true, updatedAt: now },
                  $setOnInsert: {
                    tenantId: tenantOid,
                    itemId: d._id!,
                    locationId: locId!,
                    channel: c,
                    createdAt: now,
                  },
                },
                upsert: true,
              },
            });
          }
        }
        continue;
      }

      // Channel only
      if (!hasLoc && ch) {
        const key = visKey(ch);
        channelVisibilityUpdates.push({
          updateOne: {
            filter: { _id: d._id, tenantId: tenantOid },
            update: { $set: { [`visibility.${key}`]: false, updatedAt: now, updatedBy: new ObjectId(userId) } },
          },
        });
        // Clear overlays for this channel across all locations
        deleteOverlaysFilters.push({ tenantId: tenantOid, itemId: d._id!, channel: ch });
        continue;
      }

      // No scope: hard delete this id
      hardDeleteIds.push(d._id!);
    }

    // Apply updates
    if (channelVisibilityUpdates.length) {
      await col().bulkWrite(channelVisibilityUpdates, { ordered: false });
    }
    if (perLocRemovals.length) {
      await availabilityCol().bulkWrite(perLocRemovals, { ordered: false });
    }
    if (perLocChRemovals.length) {
      await availabilityCol().bulkWrite(perLocChRemovals, { ordered: false });
    }
    if (deleteOverlaysFilters.length) {
      const or = deleteOverlaysFilters;
      await availabilityCol().deleteMany({ $or: or });
    }
    let deletedCount = 0;
    if (hardDeleteIds.length) {
      const before = await col()
        .find({ _id: { $in: hardDeleteIds }, tenantId: tenantOid })
        .toArray();

      const del = await col().deleteMany({ _id: { $in: hardDeleteIds }, tenantId: tenantOid });
      deletedCount = del.deletedCount ?? 0;

      // Clean overlays for fully deleted ids
      await availabilityCol().deleteMany({ tenantId: tenantOid, itemId: { $in: hardDeleteIds } });

      await auditLog({
        userId,
        action: 'MENU_ITEM_BULK_DELETE',
        before: before.map(toMenuItemDTO),
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      const remaining = await col().countDocuments({ tenantId: tenantOid });
      await tenantsCol().updateOne(
        { _id: tenantOid },
        { $set: { 'onboardingProgress.hasMenuItem': remaining > 0, updatedAt: new Date() } }
      );
    } else {
      // Scoped deletes audit
      await auditLog({
        userId,
        action: 'MENU_ITEM_BULK_DELETE',
        before: docs.map(toMenuItemDTO),
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });
    }

    return res.ok({ deletedCount, ids });
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
