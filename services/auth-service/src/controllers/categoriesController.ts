/**
 * Categories controller
 * - List, create, update (POST), delete (POST) per-user categories
 * - Delete cascades: removing a category deletes all menuItems with that category for the same user
 */
import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { CategoryDoc } from '../models/Category.js';
import { toCategoryDTO } from '../utils/mapper.js';
import { auditLog } from '../utils/audit.js';

function categoriesCol() {
  return client.db('authDB').collection<CategoryDoc>('categories');
}

function menuItemsCol() {
  return client.db('authDB').collection('menuItems');
}

export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const docs = await categoriesCol()
      .find({ userId: new ObjectId(userId) })
      .sort({ name: 1 })
      .toArray();
    return res.ok({ items: docs.map(toCategoryDTO) });
  } catch (err) {
    logger.error(`listCategories error: ${(err as Error).message}`);
    next(err);
  }
}

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
    const created: CategoryDoc = { ...doc, _id: result.insertedId };

    await auditLog({
      userId,
      action: 'CATEGORY_CREATE',
      after: toCategoryDTO(created),
      ip: req.ip || (req.connection as any).remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toCategoryDTO(created) }, 201);
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.fail(409, 'Category already exists.');
    }
    logger.error(`createCategory error: ${(err as Error).message}`);
    next(err);
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const { id } = req.params;
    const { name } = req.body as { name: string };
    if (!ObjectId.isValid(id)) return res.fail(400, 'Invalid id');

    const before = await categoriesCol().findOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
    if (!before) return res.fail(404, 'Category not found');

    const r: any = await categoriesCol().findOneAndUpdate(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: { name, updatedAt: new Date() } },
      { returnDocument: 'after' as any }
    );
    const doc = (r && 'value' in r ? r.value : r) ?? null;
    if (!doc) return res.fail(404, 'Category not found');

    await auditLog({
      userId,
      action: 'CATEGORY_UPDATE',
      before: toCategoryDTO(before),
      after: toCategoryDTO(doc),
      ip: req.ip || (req.connection as any).remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toCategoryDTO(doc) });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.fail(409, 'Category already exists.');
    }
    logger.error(`updateCategory error: ${(err as Error).message}`);
    next(err);
  }
}

export async function deleteCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.fail(400, 'Invalid id');

    const cat = await categoriesCol().findOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
    if (!cat) return res.fail(404, 'Category not found');

    const delItems = await menuItemsCol().deleteMany({
      userId: new ObjectId(userId),
      category: cat.name,
    });

    await categoriesCol().deleteOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });

    await auditLog({
      userId,
      action: 'CATEGORY_DELETE',
      before: toCategoryDTO(cat),
      metadata: { deletedProducts: delItems.deletedCount || 0 },
      ip: req.ip || (req.connection as any).remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    logger.info(
      `Category deleted: ${cat.name} for user ${userId}. Also deleted ${delItems.deletedCount} menu items.`
    );

    return res.ok({ deleted: true, deletedProducts: delItems.deletedCount || 0 });
  } catch (err) {
    logger.error(`deleteCategory error: ${(err as Error).message}`);
    next(err);
  }
}