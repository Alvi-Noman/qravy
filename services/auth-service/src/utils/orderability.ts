/**
 * Server-side "can this be ordered right now?" check.
 * Combines restaurant/branch opening hours, category hours (with per-branch
 * overrides), item hours and sold-out switches — all in the restaurant's time zone. At a branch, also what the
 * branch's menu leaves out (as the menu page does): another branch's own categories, and categories it took off.
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
  /** what's served at `at` whatever the opening hours (the menu page while the restaurant is closed) */
  ignoreOpeningHours?: boolean;
}): Promise<Map<string, OrderabilityResult>> {
  const at = opts.at ?? new Date();
  const db = client.db('authDB');
  const out = new Map<string, OrderabilityResult>();
  if (!opts.itemIds.length) return out;

  const tenant = await db
    .collection('tenants')
    .findOne({ _id: opts.tenantOid }, { projection: { timezone: 1, openingHours: 1, servicePeriods: 1, categoryHoursMode: 1 } });
  const periods = tenantServicePeriods(tenant as any);
  // the restaurant switches its categories on and off by hand: a category's serving hours don't apply
  const manualCats = tenant?.categoryHoursMode === 'manual';
  const tz: string = tenant?.timezone ?? DEFAULT_TIMEZONE;

  let openingHours: AvailabilityWindow[] = tenant?.openingHours ?? [];
  let branchName: string | null = null;
  if (opts.locationId) {
    const loc = await db
      .collection('locations')
      .findOne({ _id: opts.locationId, tenantId: opts.tenantOid }, { projection: { openingHours: 1, name: 1 } });
    if (Array.isArray(loc?.openingHours)) openingHours = loc!.openingHours;
    branchName = typeof loc?.name === 'string' ? loc.name : null;
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
          hidden: 1,
          status: 1,
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
          { projection: { name: 1, availability: 1, branchAvailability: 1, servicePeriodIds: 1, scope: 1, locationId: 1 } }
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

  // Categories this branch took off (or hid on) its menu, for this channel
  const offCats =
    opts.locationId && catIds.length
      ? await db
          .collection('categoryVisibility')
          .find({
            tenantId: opts.tenantOid,
            categoryId: { $in: catIds },
            locationId: opts.locationId,
            ...(opts.channel ? { channel: opts.channel } : {}),
            $or: [{ removed: true }, { visible: false }],
          })
          .project({ categoryId: 1 })
          .toArray()
      : [];
  const offCatIds = new Set(offCats.map((v) => String(v.categoryId)));

  for (const it of items) {
    const id = String(it._id);
    // hidden by the owner (the admin's hide) — never orderable, as the menu page and the waiter have it
    if (it.hidden === true || it.status === 'hidden') {
      out.set(id, { ok: false, reason: 'hidden', message: `${it.name} isn't on the menu.` });
      continue;
    }
    if (offIds.has(id) || it.offline) {
      out.set(id, { ok: false, reason: 'sold-out', message: `${it.name} is sold out right now.` });
      continue;
    }
    const cat = it.categoryId ? catById.get(String(it.categoryId)) : undefined;
    if (
      opts.locationId &&
      ((cat?.scope === 'location' && String(cat.locationId ?? '') !== String(opts.locationId)) ||
        offCatIds.has(String(it.categoryId ?? '')))
    ) {
      out.set(id, { ok: false, reason: 'not-at-branch', message: `${it.name} isn't on the menu at this branch.` });
      continue;
    }
    const branchOverride = opts.locationId
      ? (cat?.branchAvailability as Array<{ locationId: ObjectId; availability: AvailabilityWindow[] }> | undefined)?.find(
          (b) => String(b.locationId) === String(opts.locationId)
        )
      : undefined;
    const res = orderableNow({
      tz,
      at,
      openingHours: opts.ignoreOpeningHours ? [] : openingHours,
      categoryHours: manualCats
        ? []
        : branchOverride
          ? branchOverride.availability
          : resolveWindows(cat?.servicePeriodIds, cat?.availability, periods),
      itemHours: resolveWindows(it.servicePeriodIds, it.availability, periods),
      itemFrom: it.availableFrom,
      itemUntil: it.availableUntil,
      categoryName: cat?.name,
    });
    // closed at a branch: say which (the restaurant's other branches may well be open)
    const message = !res.ok && res.reason === 'closed' && branchName ? `${branchName} is closed right now.` : !res.ok ? res.message : '';
    out.set(id, res.ok ? res : { ok: false, reason: res.reason, message });
  }
  return out;
}
