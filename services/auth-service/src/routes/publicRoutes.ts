import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import { toMenuItemDTO } from '../utils/mapper.js';
import type { TenantDoc } from '../models/Tenant.js';
import type { MenuItemDoc } from '../models/MenuItem.js';
import type { ItemAvailabilityDoc } from '../models/ItemAvailability.js';

const router: express.Router = express.Router();

const CHANNELS: Array<'dine-in' | 'online'> = ['dine-in', 'online'];

const querySchema = z.object({
  subdomain: z.string().min(1, 'subdomain is required'),
  branch: z.string().trim().min(1).optional(),
  channel: z.enum(['online', 'dine-in']).optional(),
});

function parseChannel(v: unknown): 'dine-in' | 'online' | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  if (s === 'dine-in' || s === 'dinein' || s === 'dine_in') return 'dine-in';
  if (s === 'online') return 'online';
  return undefined;
}
function visKey(ch: 'dine-in' | 'online'): 'dineIn' | 'online' {
  return ch === 'dine-in' ? 'dineIn' : 'online';
}
function baseVisible(doc: MenuItemDoc, ch: 'dine-in' | 'online'): boolean {
  const k = visKey(ch);
  const v = doc.visibility?.[k as 'dineIn' | 'online'];
  return typeof v === 'boolean' ? v : true;
}

/**
 * GET /api/v1/public/menu?subdomain=...&branch=...&channel=online|dine-in
 * Public, read-only storefront menu for a tenant (and optional branch).
 */
router.get('/public/menu', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      const msg = parsed.error.issues?.[0]?.message || 'Invalid query';
      return res.status(400).json({ message: msg });
    }
    const { subdomain, branch, channel } = parsed.data;
    const qCh = parseChannel(channel);

    const tenants = client.db('authDB').collection<TenantDoc>('tenants');
    const tenant = await tenants.findOne({ subdomain });
    if (!tenant?._id) {
      return res.status(404).json({ message: 'Tenant not found' });
    }
    const tenantOid = tenant._id;

    // Resolve branch (location) if provided
    let locId: ObjectId | null = null;
    if (branch && branch.trim()) {
      const locations = client.db('authDB').collection('locations');
      const norm = (s: string) =>
        s
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '')
          .replace(/--+/g, '-')
          .replace(/^-|-$/g, '');
      const branchNorm = norm(branch);

      const locDoc = await locations.findOne({
        tenantId: tenantOid,
        $or: [
          // exact name match (case-insensitive)
          { name: { $regex: `^${branch}$`, $options: 'i' } },
          // naive slug match
          { name: { $regex: `^${branchNorm.replace(/-/g, '[\\s-]')}$`, $options: 'i' } },
        ],
      });
      if (locDoc?._id) {
        locId = locDoc._id as ObjectId;
      }
    }

    // Collections
    const itemsCol = client.db('authDB').collection<MenuItemDoc>('menuItems');
    const catsCol = client.db('authDB').collection('categories');
    const catVisCol = client.db('authDB').collection('categoryVisibility');
    const availCol = client.db('authDB').collection<ItemAvailabilityDoc>('itemAvailability');

    // Branch-aware filter: include global items and items scoped to this location
    const filter: any =
      locId
        ? { tenantId: tenantOid, $or: [{ locationId: { $exists: false } }, { locationId: null }, { locationId: locId }] }
        : { tenantId: tenantOid };

    const docs = await itemsCol.find(filter).sort({ createdAt: -1 }).toArray();
    if (docs.length === 0) {
      return res.json({ items: [] });
    }

    // Load categories referenced
    const catIds = Array.from(
      new Set(
        docs
          .map((d) => d.categoryId)
          .filter((id): id is ObjectId => !!id && ObjectId.isValid(id as any))
          .map((id) => (id as ObjectId).toString())
      )
    ).map((s) => new ObjectId(s));

    const cats = catIds.length
      ? await catsCol
          .find({ _id: { $in: catIds }, tenantId: tenantOid })
          .project({ _id: 1, scope: 1, locationId: 1, channelScope: 1 })
          .toArray()
      : [];
    const catById = new Map<string, any>(cats.map((c: any) => [c._id.toString(), c]));

    // Category visibility overlays (branch-aware)
    const catVisQuery: any = { tenantId: tenantOid, categoryId: { $in: catIds } };
    if (locId) catVisQuery.locationId = locId;
    if (qCh) catVisQuery.channel = qCh;
    const catVis = catIds.length ? await catVisCol.find(catVisQuery).toArray() : [];

    const catOverlayByCat = new Map<string, Map<'dine-in' | 'online', boolean>>();
    const catRemovedByCat = new Map<string, Set<'dine-in' | 'online'>>();
    for (const v of catVis as any[]) {
      const catKey = v.categoryId.toString();
      const ch = v.channel as 'dine-in' | 'online';
      if (v.removed === true) {
        const set = catRemovedByCat.get(catKey) ?? new Set<'dine-in' | 'online'>();
        set.add(ch);
        catRemovedByCat.set(catKey, set);
      } else if (typeof v.visible === 'boolean') {
        const m = catOverlayByCat.get(catKey) ?? new Map<'dine-in' | 'online', boolean>();
        m.set(ch, v.visible);
        catOverlayByCat.set(catKey, m);
      }
    }

    // Item availability overlays (branch-aware)
    const overlayQuery: any = {
      tenantId: tenantOid,
      itemId: { $in: docs.map((d) => d._id!).filter(Boolean) },
    };
    if (locId) overlayQuery.locationId = locId;
    if (qCh) overlayQuery.channel = qCh;

    const overlays = await availCol.find(overlayQuery).toArray();
    const overlayByItem = new Map<string, Map<'dine-in' | 'online', boolean>>();
    const removedByItem = new Map<string, Set<'dine-in' | 'online'>>();
    for (const o of overlays as any[]) {
      const itemKey = o.itemId.toString();
      const ch = o.channel as 'dine-in' | 'online';
      if (o.removed === true) {
        const set = removedByItem.get(itemKey) ?? new Set<'dine-in' | 'online'>();
        set.add(ch);
        removedByItem.set(itemKey, set);
      } else {
        const m = overlayByItem.get(itemKey) ?? new Map<'dine-in' | 'online', boolean>();
        m.set(ch, !!o.available);
        overlayByItem.set(itemKey, m);
      }
    }

    // Helper for category channel allowance
    const catChannelAllowed = (cat: any | undefined, ch: 'dine-in' | 'online'): boolean => {
      const s = (cat as any)?.channelScope as 'all' | 'dine-in' | 'online' | undefined;
      if (!s || s === 'all') return true;
      return s === ch;
    };
    const catVisibleForCh = (
      catId: string | undefined,
      ch: 'dine-in' | 'online'
    ): boolean | undefined => {
      if (!catId) return undefined;
      return catOverlayByCat.get(catId)?.get(ch);
    };

    const out = [];
    for (const d of docs) {
      const itmKey = d._id!.toString();

      // Category constraints (scope + channel)
      let cat: any | undefined;
      let catIdStr: string | undefined;
      if (d.categoryId) {
        catIdStr = (d.categoryId as ObjectId).toString();
        cat = catById.get(catIdStr);

        // If category is location-scoped, only include when matching the requested loc
        if (cat?.scope === 'location') {
          const catLoc =
            cat.locationId && ObjectId.isValid(cat.locationId) ? (cat.locationId as ObjectId) : null;
          if (locId && (!catLoc || catLoc.toString() !== locId.toString())) {
            continue;
          }
        }
      }

      // If category hard-removed for this loc+channel → skip
      if (catIdStr && qCh && catRemovedByCat.get(catIdStr)?.has(qCh)) continue;

      // Determine channels to evaluate
      const channels: Array<'dine-in' | 'online'> = qCh ? [qCh] : CHANNELS;

      let present = false;
      let anyOn = false;

      for (const ch of channels) {
        // Category channel allowance
        if (cat && !catChannelAllowed(cat, ch)) continue;

        // If item-level tombstone for this ch at this loc → skip this channel
        if (removedByItem.get(itmKey)?.has(ch)) continue;

        const baseline = baseVisible(d, ch);
        const ov = overlayByItem.get(itmKey)?.get(ch);
        const catVisFlag = catIdStr ? catVisibleForCh(catIdStr, ch) : undefined;

        // Category soft-off ⇒ show as present but OFF
        if (catVisFlag === false) {
          present = true;
          continue;
        }

        // If baseline hides the channel, only count as ON if explicit available:true overlay exists
        if (baseline === false) {
          if (ov === true) {
            present = true;
            anyOn = true;
            break;
          }
          continue;
        }

        const finalAvail = ov !== undefined ? ov : baseline;
        present = true;
        if (finalAvail) {
          anyOn = true;
          break;
        }
      }

      if (!present) continue;

      const dto = toMenuItemDTO(d);
      dto.hidden = !anyOn;
      dto.status = anyOn ? 'active' : 'hidden';
      out.push(dto);
    }

    return res.json({ items: out });
  } catch (err) {
    logger.error(`[PUBLIC MENU] ${String((err as Error)?.message || err)}`);
    next(err);
  }
});

export default router;
