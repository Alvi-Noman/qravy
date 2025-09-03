/**
 * Menu controller
 * List, create, update, delete per-user menu items
 */
import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { MenuItemDoc, Variation } from '../models/MenuItem.js';
import { toMenuItemDTO } from '../utils/mapper.js';
import { auditLog } from '../utils/audit.js';

function col() {
  return client.db('authDB').collection<MenuItemDoc>('menuItems');
}

/** Coerce numbers from number|string */
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Normalize variations and drop undefined fields */
function normalizeVariations(list: unknown): Array<Pick<Variation, 'name'> & Partial<Variation>> {
  const arr = Array.isArray(list) ? list : [];
  const out: Array<Pick<Variation, 'name'> & Partial<Variation>> = [];
  for (const raw of arr) {
    const r = raw as Record<string, unknown>;
    const name = typeof r?.name === 'string' ? r.name.trim() : '';
    if (!name) continue;
    const p = num(r?.price);
    const imageUrl = typeof r?.imageUrl === 'string' && r.imageUrl.trim() ? (r.imageUrl as string) : undefined;

    const v: any = { name };
    if (p !== undefined && p >= 0) v.price = p;
    if (imageUrl !== undefined) v.imageUrl = imageUrl;
    out.push(v);
  }
  return out;
}

/** First priced variation */
function firstVariantPrice(variations?: Array<{ price?: number }>): number | undefined {
  if (!Array.isArray(variations)) return undefined;
  for (const v of variations) {
    if (typeof v?.price === 'number' && Number.isFinite(v.price) && v.price >= 0) return v.price;
  }
  return undefined;
}

/** GET /api/v1/auth/menu-items */
export async function listMenuItems(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.fail(401, 'Unauthorized');

    const docs = await col().find({ userId: new ObjectId(userId) }).sort({ createdAt: -1 }).toArray();
    return res.ok({ items: docs.map(toMenuItemDTO) });
  } catch (err) {
    logger.error(`listMenuItems error: ${(err as Error).message}`);
    next(err);
  }
}

/** POST /api/v1/auth/menu-items */
export async function createMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.fail(401, 'Unauthorized');

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
    };

    const now = new Date();

    const normVariations = normalizeVariations(body.variations);
    const mainPrice = num(body.price);
    const derived = firstVariantPrice(normVariations);
    const effectivePrice = mainPrice !== undefined ? mainPrice : derived;

    const cmp = num(body.compareAtPrice);
    const effectiveCompareAt =
      effectivePrice !== undefined && cmp !== undefined && cmp >= effectivePrice ? cmp : undefined;

    const doc: any = {
      userId: new ObjectId(userId),
      name: String(body.name || '').trim(),
      createdAt: now,
      updatedAt: now,
    };

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

    return res.ok({ item: toMenuItemDTO(created) }, 201);
  } catch (err: any) {
    const details = err?.errInfo?.details ? ` | details=${JSON.stringify(err.errInfo.details)}` : '';
    logger.error(`createMenuItem error: ${(err as Error).message}${details}`);
    next(err);
  }
}

/** POST /api/v1/auth/menu-items/:id/update */
export async function updateMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.fail(401, 'Unauthorized');

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
    };

    const before = await col().findOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
    if (!before) return res.fail(404, 'Item not found');

    const setOps: any = { updatedAt: new Date() };

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

    if (body.description !== undefined) setOps.description = typeof body.description === 'string' ? body.description : undefined;
    if (body.category !== undefined) setOps.category = typeof body.category === 'string' ? body.category : undefined;

    if (body.categoryId !== undefined) {
      setOps.categoryId = body.categoryId && ObjectId.isValid(body.categoryId) ? new ObjectId(body.categoryId) : undefined;
    }

    if (body.media !== undefined) {
      const media = Array.isArray(body.media) ? body.media.filter((u) => typeof u === 'string' && u) : [];
      if (media.length) setOps.media = media;
      else setOps.media = [];
    }

    if (body.variations !== undefined) {
      const norm = normalizeVariations(body.variations);
      setOps.variations = norm;
    }

    if (body.tags !== undefined) {
      const tags =
        Array.isArray(body.tags)
          ? body.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
          : [];
      setOps.tags = tags;
    }

    if (body.restaurantId !== undefined) {
      setOps.restaurantId =
        body.restaurantId && ObjectId.isValid(body.restaurantId) ? new ObjectId(body.restaurantId) : undefined;
    }

    const after = await col().findOneAndUpdate(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
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

/** POST /api/v1/auth/menu-items/:id/delete */
export async function deleteMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.fail(401, 'Unauthorized');

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.fail(400, 'Invalid id');

    const deleted = await col().findOneAndDelete(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
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

    return res.ok({ deleted: true });
  } catch (err) {
    logger.error(`deleteMenuItem error: ${(err as Error).message}`);
    next(err);
  }
}