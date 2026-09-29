/**
 * Server-side "can this be ordered right now?" check.
 * Combines restaurant/branch opening hours, category hours (with per-branch
 * overrides), item hours and sold-out switches — all in the restaurant's time zone.
 */
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import {
  DEFAULT_TIMEZONE,
  orderableNow,
  resolveWindows,
  tenantServicePeriods,
  type AvailabilityWindow,
} from './availability.js';

export type OrderabilityResult = { ok: true } | { ok: false; reason: string; message: string };

export async function checkOrderable(opts: {
  tenantOid: ObjectId;
  itemIds: ObjectId[];
  locationId?: ObjectId | null;
  channel?: 'dine-in' | 'online';
  at?: Date;
}): Promise<Map<string, OrderabilityResult>> {
  const at = opts.at ?? new Date();
  const db = client.db('authDB');
  const out = new Map<string, OrderabilityResult>();
  if (!opts.itemIds.length) return out;

  const tenant = await db
    .collection('tenants')
    .findOne({ _id: opts.tenantOid }, { projection: { timezone: 1, openingHours: 1, servicePeriods: 1 } });
  const periods = tenantServicePeriods(tenant as any);
  const tz: string = tenant?.timezone ?? DEFAULT_TIMEZONE;

  let openingHours: AvailabilityWindow[] = tenant?.openingHours ?? [];
  if (opts.locationId) {
    const loc = await db
      .collection('locations')
      .findOne({ _id: opts.locationId, tenantId: opts.tenantOid }, { projection: { openingHours: 1 } });
    if (Array.isArray(loc?.openingHours)) openingHours = loc!.openingHours;
  }

  const items = await db
    .collection('menuItems')
    .find(
      { _id: { $in: opts.itemIds }, tenantId: opts.tenantOid },
      {
        projection: {
          name: 1,
          categoryId: 1,
          availability: 1,
          offline: 1,
          servicePeriodIds: 1,
          availableFrom: 1,
          availableUntil: 1,
        },
      }
    )
    .toArray();

  const catIds = Array.from(new Set(items.map((i) => String(i.categoryId ?? '')).filter(Boolean))).map(
    (id) => new ObjectId(id)
  );
  const cats = catIds.length
    ? await db
        .collection('categories')
        .find(
          { _id: { $in: catIds }, tenantId: opts.tenantOid },
          { projection: { name: 1, availability: 1, branchAvailability: 1, servicePeriodIds: 1 } }
        )
        .toArray()
    : [];
  const catById = new Map(cats.map((c) => [String(c._id), c]));

  // Sold out (switched off) at this branch / channel
  const offOverlays = opts.locationId
    ? await db
        .collection('itemAvailability')
        .find({
          tenantId: opts.tenantOid,
          itemId: { $in: opts.itemIds },
          locationId: opts.locationId,
          ...(opts.channel ? { channel: opts.channel } : {}),
          $or: [{ available: false }, { removed: true }],
        })
        .project({ itemId: 1 })
        .toArray()
    : [];
  const offIds = new Set(offOverlays.map((o) => String(o.itemId)));

  for (const it of items) {
    const id = String(it._id);
    if (offIds.has(id) || it.offline) {
      out.set(id, { ok: false, reason: 'sold-out', message: `${it.name} is sold out right now.` });
      continue;
    }
    const cat = it.categoryId ? catById.get(String(it.categoryId)) : undefined;
    const branchOverride = opts.locationId
      ? (cat?.branchAvailability as Array<{ locationId: ObjectId; availability: AvailabilityWindow[] }> | undefined)?.find(
          (b) => String(b.locationId) === String(opts.locationId)
        )
      : undefined;
    const res = orderableNow({
      tz,
      at,
      openingHours,
      categoryHours: branchOverride
        ? branchOverride.availability
        : resolveWindows(cat?.servicePeriodIds, cat?.availability, periods),
      itemHours: resolveWindows(it.servicePeriodIds, it.availability, periods),
      itemFrom: it.availableFrom,
      itemUntil: it.availableUntil,
      categoryName: cat?.name,
    });
    out.set(id, res.ok ? res : { ok: false, reason: res.reason, message: res.message });
  }
  return out;
}
