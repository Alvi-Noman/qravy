// services/auth-service/src/routes/publicRoutes.ts
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

/* -------------------------------------------------------------------------- */
/*                             Tenant lookup helper                           */
/* -------------------------------------------------------------------------- */

async function findTenantBySubdomain(subdomain: string): Promise<TenantDoc | null> {
  const tenants = client.db('authDB').collection<TenantDoc>('tenants');
  return tenants.findOne({ subdomain });
}

function toPublicTenantItem(tenant: TenantDoc, fallbackSub: string) {
  return {
    id: tenant._id!.toString(),
    name:
      (tenant as any).name ??
      (tenant as any).restaurantName ??
      (tenant as any).title ??
      fallbackSub,
    subdomain: tenant.subdomain,
    logoUrl:
      (tenant as any).branding?.logoUrl ??
      (tenant as any).logoUrl ??
      (tenant as any).logo?.url ??
      null,
    brandColor:
      (tenant as any).branding?.primaryColor ??
      (tenant as any).brandColor ??
      null,
  };
}

/* -------------------------------------------------------------------------- */
/*                               Public tenant                                */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/v1/public/tenant?subdomain=...
 * Public, read-only tenant info for storefront header (returns { item })
 */
router.get('/public/tenant', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({ subdomain: z.string().min(1, 'subdomain is required') })
      .safeParse(req.query);

    if (!parsed.success) {
      const msg = parsed.error.issues?.[0]?.message || 'Invalid query';
      return res.status(400).json({ message: msg });
    }
    const { subdomain } = parsed.data;

    const tenant = await findTenantBySubdomain(subdomain);
    if (!tenant?._id) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    const item = toPublicTenantItem(tenant, subdomain);
    return res.json({ item });
  } catch (err) {
    logger.error(`[PUBLIC TENANT] ${String((err as Error)?.message || err)}`);
    next(err);
  }
});

/**
 * GET /api/v1/public/tenant/:subdomain
 * Path-style alias: /public/tenant/chillox → same shape as query version.
 */
router.get(
  '/public/tenant/:subdomain',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subdomain = String(req.params.subdomain || '').trim();
      if (!subdomain) {
        return res.status(400).json({ message: 'subdomain is required' });
      }

      const tenant = await findTenantBySubdomain(subdomain);
      if (!tenant?._id) {
        return res.status(404).json({ message: 'Tenant not found' });
      }

      const item = toPublicTenantItem(tenant, subdomain);
      return res.json({ item });
    } catch (err) {
      logger.error(
        `[PUBLIC TENANT PARAM] ${String((err as Error)?.message || err)}`
      );
      next(err);
    }
  }
);

/* -------------------------------------------------------------------------- */
/*                                 Public menu                                */
/* -------------------------------------------------------------------------- */

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

    const tenant = await findTenantBySubdomain(subdomain);
    if (!tenant?._id) {
      return res.status(404).json({ message: 'Tenant not found' });
    }
    const tenantOid = tenant._id!;

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
          { name: { $regex: `^${branch}$`, $options: 'i' } },
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

    const filter: any =
      locId
        ? {
            tenantId: tenantOid,
            $or: [
              { locationId: { $exists: false } },
              { locationId: null },
              { locationId: locId },
            ],
          }
        : { tenantId: tenantOid };

    const docs = await itemsCol.find(filter).sort({ createdAt: -1 }).toArray();
    if (docs.length === 0) {
      return res.json({ items: [] });
    }

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

    const out: any[] = [];
    for (const d of docs) {
      const itmKey = d._id!.toString();

      let cat: any | undefined;
      let catIdStr: string | undefined;
      if (d.categoryId) {
        catIdStr = (d.categoryId as ObjectId).toString();
        cat = catById.get(catIdStr);

        if (cat?.scope === 'location') {
          const catLoc =
            cat.locationId && ObjectId.isValid(cat.locationId)
              ? (cat.locationId as ObjectId)
              : null;
          if (locId && (!catLoc || catLoc.toString() !== locId.toString())) {
            continue;
          }
        }
      }

      if (catIdStr && qCh && catRemovedByCat.get(catIdStr)?.has(qCh)) continue;

      const channels: Array<'dine-in' | 'online'> = qCh ? [qCh] : CHANNELS;
      let present = false;
      let anyOn = false;

      for (const ch of channels) {
        if (cat && !catChannelAllowed(cat, ch)) continue;
        if (removedByItem.get(itmKey)?.has(ch)) continue;

        const baseline = baseVisible(d, ch);
        const ov = overlayByItem.get(itmKey)?.get(ch);
        const catVisFlag = catIdStr ? catVisibleForCh(catIdStr, ch) : undefined;

        if (catVisFlag === false) {
          present = true;
          continue;
        }

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

/* -------------------------------------------------------------------------- */
/*                             Public categories                              */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/v1/public/categories?subdomain=...&branch=...&channel=...
 * Public, read-only categories list for storefront
 */
router.get('/public/categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      const msg = parsed.error.issues?.[0]?.message || 'Invalid query';
      return res.status(400).json({ message: msg });
    }
    const { subdomain, branch, channel } = parsed.data;
    const qCh = parseChannel(channel);

    const tenant = await findTenantBySubdomain(subdomain);
    if (!tenant?._id) {
      return res.status(404).json({ message: 'Tenant not found' });
    }
    const tenantOid = tenant._id!;

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
          { name: { $regex: `^${branch}$`, $options: 'i' } },
          { name: { $regex: `^${branchNorm.replace(/-/g, '[\\s-]')}$`, $options: 'i' } },
        ],
      });
      if (locDoc?._id) {
        locId = locDoc._id as ObjectId;
      }
    }

    const catsCol = client.db('authDB').collection('categories');
    const catVisCol = client.db('authDB').collection('categoryVisibility');

    const filter: any = { tenantId: tenantOid };
    const cats = await catsCol
      .find(filter)
      .project({ _id: 1, name: 1, scope: 1, channelScope: 1, locationId: 1 })
      .toArray();

    // Filter out location-scoped categories that don't match the requested branch
    const catsScoped = cats.filter((c) => {
      if (c.scope !== 'location') return true;
      if (!locId || !c.locationId) return false;
      return String(c.locationId) === String(locId);
    });

    // Apply visibility overlay logic
    const catIds = catsScoped.map((c) => c._id as ObjectId);
    const visQuery: any = { tenantId: tenantOid, categoryId: { $in: catIds } };
    if (locId) visQuery.locationId = locId;
    if (qCh) visQuery.channel = qCh;

    const visDocs = await catVisCol.find(visQuery).toArray();
    const removed = new Set<string>();
    const hidden = new Set<string>();

    for (const v of visDocs) {
      const id = (v.categoryId as ObjectId).toString();
      if (v.removed) removed.add(id);
      else if (v.visible === false) hidden.add(id);
    }

    // Respect channelScope when channel is requested, remove tombstoned, include hidden flag
    const filteredByChannel = qCh
      ? catsScoped.filter(
          (c) =>
            (c.channelScope ?? 'all') === 'all' ||
            c.channelScope === qCh
        )
      : catsScoped;

    const out = filteredByChannel
      .filter((c) => !removed.has(c._id.toString()))
      .map((c) => ({
        id: c._id.toString(),
        name: c.name ?? 'Untitled',
        channelScope: c.channelScope ?? 'all',
        hidden: hidden.has(c._id.toString()),
        // placeholders to satisfy DTOs that expect timestamps
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }));

    res.json({ items: out });
  } catch (err) {
    logger.error(`[PUBLIC CATEGORIES] ${String((err as Error)?.message || err)}`);
    next(err);
  }
});

export default router;
