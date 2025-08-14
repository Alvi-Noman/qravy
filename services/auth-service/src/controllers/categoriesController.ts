/**
 * Categories controller
 * - List, create, update (POST), delete (POST) per-user categories
 * - Delete cascades: removing a category deletes all menuItems with that category for the same user
 */
import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';

type CategoryDoc = {
  _id?: ObjectId;
  userId: ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

function categoriesCol() {
  return client.db('authDB').collection<CategoryDoc>('categories');
}

function menuItemsCol() {
  // menu items store "category" as the category name (string)
  return client.db('authDB').collection('menuItems');
}

/** GET /api/v1/auth/categories (JWT) */
export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const docs = await categoriesCol()
      .find({ userId: new ObjectId(userId) })
      .sort({ name: 1 })
      .toArray();
    res.json({ items: docs });
  } catch (err) {
    logger.error(`listCategories error: ${(err as Error).message}`);
    next(err);
  }
}

/** POST /api/v1/auth/categories (JWT) */
export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const { name } = req.body as { name: string };

    const now = new Date();
    const doc: CategoryDoc = {
      userId: new ObjectId(userId),
      name,
      createdAt: now,
      updatedAt: now,
    };

    const result = await categoriesCol().insertOne(doc);
    res.status(201).json({ item: { ...doc, _id: result.insertedId } });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'Category already exists.' });
    }
    logger.error(`createCategory error: ${(err as Error).message}`);
    next(err);
  }
}

/** POST /api/v1/auth/categories/:id/update (JWT) */
export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const { id } = req.params;
    const { name } = req.body as { name: string };
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid id' });

    const r: any = await categoriesCol().findOneAndUpdate(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: { name, updatedAt: new Date() } },
      { returnDocument: 'after' as any }
    );
    const doc = (r && 'value' in r ? r.value : r) ?? null;
    if (!doc) return res.status(404).json({ message: 'Category not found' });

    res.json({ item: doc });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'Category already exists.' });
    }
    logger.error(`updateCategory error: ${(err as Error).message}`);
    next(err);
  }
}

/** POST /api/v1/auth/categories/:id/delete (JWT) */
export async function deleteCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid id' });

    // 1) Find the category to get its name
    const cat = await categoriesCol().findOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
    if (!cat) return res.status(404).json({ message: 'Category not found' });

    // 2) Delete all menu items for this user that reference this category name
    const delItems = await menuItemsCol().deleteMany({
      userId: new ObjectId(userId),
      category: cat.name,
    });

    // 3) Delete the category
    await categoriesCol().deleteOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });

    logger.info(
      `Category deleted: ${cat.name} for user ${userId}. Also deleted ${delItems.deletedCount} menu items.`
    );

    res.json({ deleted: true, deletedProducts: delItems.deletedCount || 0 });
  } catch (err) {
    logger.error(`deleteCategory error: ${(err as Error).message}`);
    next(err);
  }
}