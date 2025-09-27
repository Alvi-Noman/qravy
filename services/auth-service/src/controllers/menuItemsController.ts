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
  // default baseline visible if not specified
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
    const qCh = parseChannel(req.query.channel);
    const tenantOid = new ObjectId(tenantId);

    const baseFilter: any = { tenantId: tenantOid };

    // Helper to set final dto.hidden/status based on boolean available
    const mark = (available: boolean, dto: ReturnType<typeof toMenuItemDTO>) => {
      dto.hidden = !available;
      dto.status = available ? 'active' : 'hidden';
      return dto;
    };

    // Branch view: global + that branch, overlay applied
    if (qLoc && ObjectId.isValid(qLoc)) {
      const locId = new ObjectId(qLoc);
      const filter = {
        ...baseFilter,
        $or: [{ locationId: { $exists: false } }, { locationId: null }, { locationId: locId }],
      };
      const docs = await col().find(filter).sort({ createdAt: -1 }).toArray();
      if (docs.length === 0) return res.ok({ items: [] });

      // Load overlays for this location (either one channel or both)
      const overlayQuery: any = {
        tenantId: tenantOid,
        locationId: locId,
        itemId: { $in: docs.map((d) => d._id!).filter(Boolean) },
      };
      if (qCh) overlayQuery.channel = qCh;

      const overlays = await availabilityCol().find(overlayQuery).toArray();
      // Build: itemId -> channel -> available
      const overlayByItem = new Map<
        string,
        Map<'dine-in' | 'online', boolean>
      >();
      for (const o of overlays) {
        const itemKey = o.itemId.toString();
        const m = overlayByItem.get(itemKey) ?? new Map();
        m.set(o.channel as 'dine-in' | 'online', !!o.available);
        overlayByItem.set(itemKey, m);
      }

      const items = docs.map((d) => {
        const dto = toMenuItemDTO(d);
        const itmKey = d._id!.toString();
        const channelSet = qCh ? [qCh] : CHANNELS;

        let availableAny = false;
        for (const ch of channelSet) {
          const baseline = baseVisible(d, ch);
          const o = overlayByItem.get(itmKey)?.get(ch);
          const finalAvail = o !== undefined ? o : baseline;
          availableAny = availableAny || finalAvail;
        }
        return mark(availableAny, dto);
      });

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
    // Build: itemId -> channel -> Map<locationId, available>
    const overlayByItemAll = new Map<
      string,
      Map<'dine-in' | 'online', Map<string, boolean>>
    >();
    for (const o of overlaysAll) {
      const itemKey = o.itemId.toString();
      const ch = o.channel as 'dine-in' | 'online';
      const chMap = overlayByItemAll.get(itemKey) ?? new Map();
      const locMap = chMap.get(ch) ?? new Map<string, boolean>();
      locMap.set(o.locationId.toString(), !!o.available);
      chMap.set(ch, locMap);
      overlayByItemAll.set(itemKey, chMap);
    }

    const items = docs.map((d) => {
      const dto = toMenuItemDTO(d);
      const itmKey = d._id!.toString();

      const channelsToEval = qCh ? [qCh] : CHANNELS;

      const availForChannel = (ch: 'dine-in' | 'online'): boolean => {
        const baseline = baseVisible(d, ch);
        if (locCount === 0) return baseline;

        const perChLoc = overlayByItemAll.get(itmKey)?.get(ch) ?? new Map<string, boolean>();

        if (d.locationId) {
          // Branch-only item: evaluate only its own branch
          const k = (d.locationId as ObjectId).toString();
          const ov = perChLoc.get(k);
          return ov !== undefined ? ov : baseline;
        }

        // Global item across all locations for this channel
        if (baseline === true) {
          // Available unless every location is explicitly overridden to false
          // If any location missing an overlay (implicit baseline true) -> available
          let allOff = true;
          for (const lid of locIds) {
            const key = lid.toString();
            const ov = perChLoc.get(key);
            if (ov === true) { allOff = false; break; }
            if (ov === undefined) { allOff = false; break; } // baseline true applies
          }
          return !allOff;
        } else {
          // baseline false: available only if any location overlay turns it on
          for (const v of perChLoc.values()) {
            if (v === true) return true;
          }
          return false;
        }
      };

      // If channel specified, use that channel’s availability aggregated across locations.
      // If "All channels", item is available if it’s available in any channel across locations.
      let availableAny = false;
      for (const ch of channelsToEval) {
        if (availForChannel(ch)) {
          availableAny = true;
          break;
        }
      }

      return mark(availableAny, dto);
    });

    return res.ok({ items });
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
      locationId?: string;
      channel?: 'dine-in' | 'online';
    };

    const now = new Date();
    const normVariations = normalizeVariations(body.variations);
    const mainPrice = num(body.price);
    const derived = firstVariantPrice(normVariations);
    const effectivePrice = mainPrice !== undefined ? mainPrice : derived;
    const cmp = num(body.compareAtPrice);
    const effectiveCompareAt =
      effectivePrice !== undefined && cmp !== undefined && cmp >= effectivePrice ? cmp : undefined;

    // Baseline hidden/status kept for legacy; channel behavior driven by visibility + overlays
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

    // Channel baseline visibility
    const ch = parseChannel(body.channel);
    if (ch) {
      // Create visible only in the selected channel by default
      doc.visibility = {
        dineIn: ch === 'dine-in',
        online: ch === 'online',
      };
    } else {
      // "All channels": visible in both by default
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

    // Branch-specific: upsert overlay for that location (one or both channels)
    if (locationId && ObjectId.isValid(locationId)) {
      const locId = new ObjectId(locationId);

      const ops = [];
      for (const ch of chs) {
        for (const itemId of oids) {
          ops.push({
            updateOne: {
              filter: { tenantId: new ObjectId(tenantId), itemId, locationId: locId, channel: ch },
              update: {
                $set: { available: !!active, updatedAt: now },
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

    // "All locations" toggle:
    // With channel: apply only for that channel across all branches.
    // Without channel: fan out to both channels across all branches.
    const locDocs = await locationsCol()
      .find({ tenantId: new ObjectId(tenantId) }, { projection: { _id: 1 } })
      .toArray();
    const locIds = locDocs.map((l: any) => l._id as ObjectId);

    if (active === true) {
      // Remove overlays for selected channels (back to baseline ON for those channels)
      await availabilityCol().deleteMany({
        tenantId: new ObjectId(tenantId),
        itemId: { $in: oids },
        ...(locIds.length ? { locationId: { $in: locIds } } : {}),
        channel: { $in: chs },
      });

      // Set baseline visibility for these channels to true
      const setOps: any = { updatedAt: now, updatedBy: new ObjectId(userId) };
      for (const ch of chs) {
        const key = `visibility.${visKey(ch)}`;
        setOps[key] = true;
      }
      await col().updateMany(
        { _id: { $in: oids }, tenantId: new ObjectId(tenantId) },
        { $set: setOps }
      );
    } else {
      // Upsert overlays=false for all locations and selected channels
      if (locIds.length > 0) {
        const ops = [];
        for (const itemId of oids) {
          for (const lid of locIds) {
            for (const ch of chs) {
              ops.push({
                updateOne: {
                  filter: { tenantId: new ObjectId(tenantId), itemId, locationId: lid, channel: ch },
                  update: {
                    $set: { available: false, updatedAt: now },
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

      // Set baseline visibility for these channels to false
      const setOps: any = { updatedAt: now, updatedBy: new ObjectId(userId) };
      for (const ch of chs) {
        const key = `visibility.${visKey(ch)}`;
        setOps[key] = false;
      }
      await col().updateMany(
        { _id: { $in: oids }, tenantId: new ObjectId(tenantId) },
        { $set: setOps }
      );
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