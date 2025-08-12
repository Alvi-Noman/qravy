/**
 * Menu controller
 * - List and create per-user menu items
 */
import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { MenuItemDoc } from '../models/MenuItem.js';
import { toMenuItemDTO } from '../utils/mapper.js';

/** Typed collection helper */
function menuItemsCollection() {
  return client.db('authDB').collection<MenuItemDoc>('menuItems');
}

/** GET /api/v1/auth/menu-items (JWT required) */
export async function listMenuItems(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const col = menuItemsCollection();
    const docs = await col.find({ userId: new ObjectId(userId) }).sort({ createdAt: -1 }).toArray();
    res.json({ items: docs.map(toMenuItemDTO) });
  } catch (err) {
    logger.error(`listMenuItems error: ${(err as Error).message}`);
    next(err);
  }
}

/** POST /api/v1/auth/menu-items (JWT required) */
export async function createMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const { name, price, description, category } = req.body as {
      name: string; price: number; description?: string; category?: string;
    };

    const now = new Date();
    const doc: MenuItemDoc = {
      userId: new ObjectId(userId),
      name,
      price,
      description,
      category,
      createdAt: now,
      updatedAt: now,
    };

    const col = menuItemsCollection();
    const result = await col.insertOne(doc);
    const created: MenuItemDoc = { ...doc, _id: result.insertedId };

    res.status(201).json({ item: toMenuItemDTO(created) });
  } catch (err) {
    logger.error(`createMenuItem error: ${(err as Error).message}`);
    next(err);
  }
}