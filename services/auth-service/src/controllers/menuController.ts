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

/** Normalize variations: trim name, drop blanks, keep only valid prices */
function normalizeVariations(list: unknown): Variation[] {
  const arr = Array.isArray(list) ? list : [];
  const out: Variation[] = [];
  for (const raw of arr) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    const rawPrice = raw?.price;
    const price =
      typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice >= 0
        ? rawPrice
        : undefined;
    const imageUrl = typeof raw?.imageUrl === 'string' ? raw.imageUrl : undefined;
    out.push({ name, price, imageUrl });
  }
  return out;
}

/** GET /api/v1/auth/menu-items (JWT required) */
export async function listMenuItems(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.fail(401, 'Unauthorized');

    const docs = await col()
      .find({ userId: new ObjectId(userId) })
      .sort({ createdAt: -1 })
      .toArray();

    return res.ok({ items: docs.map(toMenuItemDTO) });
  } catch (err) {
    logger.error(`listMenuItems error: ${(err as Error).message}`);
    next(err);
  }
}

/** POST /api/v1/auth/menu-items (JWT required) */
export async function createMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.fail(401, 'Unauthorized');

    const {
      name,
      price,
      compareAtPrice,
      description,
      category,
      categoryId,
      media,
      variations,
      tags,
      restaurantId,
    } = req.body as {
      name: string;
      price: number;
      compareAtPrice?: number;
      description?: string;
      category?: string;
      categoryId?: string;
      media?: string[];
      variations?: Variation[];
      tags?: string[];
      restaurantId?: string;
    };

    const normVariations = normalizeVariations(variations);
    const now = new Date();

    const doc: MenuItemDoc = {
      userId: new ObjectId(userId),
      restaurantId: restaurantId && ObjectId.isValid(restaurantId) ? new ObjectId(restaurantId) : undefined,
      name: String(name || '').trim(),
      price,
      compareAtPrice: typeof compareAtPrice === 'number' ? compareAtPrice : undefined,
      description: typeof description === 'string' ? description : undefined,
      category: typeof category === 'string' ? category : undefined,
      categoryId: categoryId && ObjectId.isValid(categoryId) ? new ObjectId(categoryId) : undefined,
      media: Array.isArray(media) ? media.filter((u) => typeof u === 'string' && u) : [],
      variations: normVariations,
      tags: Array.isArray(tags) ? tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : [],
      createdAt: now,
      updatedAt: now,
    };

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
  } catch (err) {
    logger.error(`createMenuItem error: ${(err as Error).message}`);
    next(err);
  }
}

/** POST /api/v1/auth/menu-items/:id/update (JWT required) */
export async function updateMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.fail(401, 'Unauthorized');

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.fail(400, 'Invalid id');

    const {
      name,
      price,
      compareAtPrice,
      description,
      category,
      categoryId,
      media,
      variations,
      tags,
      restaurantId,
    } = req.body as {
      name?: string;
      price?: number;
      compareAtPrice?: number;
      description?: string;
      category?: string;
      categoryId?: string;
      media?: string[];
      variations?: Variation[];
      tags?: string[];
      restaurantId?: string;
    };

    const before = await col().findOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
    if (!before) return res.fail(404, 'Item not found');

    const setOps: Partial<MenuItemDoc> = {};
    if (name !== undefined) setOps.name = String(name || '').trim();
    if (price !== undefined) setOps.price = price;
    if (compareAtPrice !== undefined) setOps.compareAtPrice = compareAtPrice;
    if (description !== undefined) setOps.description = typeof description === 'string' ? description : undefined;
    if (category !== undefined) setOps.category = typeof category === 'string' ? category : undefined;
    if (categoryId !== undefined) {
      setOps.categoryId = categoryId && ObjectId.isValid(categoryId) ? new ObjectId(categoryId) : undefined;
    }
    if (media !== undefined) setOps.media = Array.isArray(media) ? media.filter((u) => typeof u === 'string' && u) : [];
    if (variations !== undefined) setOps.variations = normalizeVariations(variations);
    if (tags !== undefined)
      setOps.tags = Array.isArray(tags) ? tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : [];
    if (restaurantId !== undefined) {
      setOps.restaurantId = restaurantId && ObjectId.isValid(restaurantId) ? new ObjectId(restaurantId) : undefined;
    }

    const after = await col().findOneAndUpdate(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: { ...setOps, updatedAt: new Date() } },
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
  } catch (err) {
    logger.error(`updateMenuItem error: ${(err as Error).message}`);
    next(err);
  }
}

/** POST /api/v1/auth/menu-items/:id/delete (JWT required) */
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