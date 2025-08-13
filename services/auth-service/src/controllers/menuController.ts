/**
 * Menu controller
 * - List, create, update (POST), delete (POST) per-user menu items
 */
import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';

type MenuItemDoc = {
  _id?: ObjectId;
  userId: ObjectId;
  name: string;
  price: number;
  description?: string;
  category?: string;
  createdAt: Date;
  updatedAt: Date;
};

function col() {
  return client.db('authDB').collection<MenuItemDoc>('menuItems');
}

/** GET /api/v1/auth/menu-items (JWT required) */
export async function listMenuItems(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const docs = await col()
      .find({ userId: new ObjectId(userId) })
      .sort({ createdAt: -1 })
      .toArray();

    // Return raw docs; client maps _id -> id
    res.json({ items: docs });
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

    const result = await col().insertOne(doc);
    const created: MenuItemDoc = { ...doc, _id: result.insertedId };

    res.status(201).json({ item: created });
  } catch (err) {
    logger.error(`createMenuItem error: ${(err as Error).message}`);
    next(err);
  }
}

/** POST /api/v1/auth/menu-items/:id/update (JWT required) */
export async function updateMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid id' });

    const { name, price, description, category } = req.body as {
      name?: string; price?: number; description?: string; category?: string;
    };

    const updates: Partial<Pick<MenuItemDoc, 'name' | 'price' | 'description' | 'category'>> = {};
    if (name !== undefined) updates.name = name;
    if (price !== undefined) updates.price = price;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;

    // Use 'returnDocument: "after"' for updated doc; normalize return shape
    const r: any = await col().findOneAndUpdate(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: 'after' as any }
    );

    const doc: MenuItemDoc | null = (r && 'value' in r ? r.value : r) ?? null;
    if (!doc) return res.status(404).json({ message: 'Item not found' });

    res.json({ item: doc });
  } catch (err) {
    logger.error(`updateMenuItem error: ${(err as Error).message}`);
    next(err);
  }
}

/** POST /api/v1/auth/menu-items/:id/delete (JWT required) */
export async function deleteMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid id' });

    const result = await col().deleteOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
    if (result.deletedCount === 0) return res.status(404).json({ message: 'Item not found' });

    res.json({ deleted: true });
  } catch (err) {
    logger.error(`deleteMenuItem error: ${(err as Error).message}`);
    next(err);
  }
}