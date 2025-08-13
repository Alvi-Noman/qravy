/**
 * Categories controller
 * - List and create per-user categories
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

function col() {
  return client.db('authDB').collection<CategoryDoc>('categories');
}

/** GET /api/v1/auth/categories (JWT required) */
export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id as string;
    const docs = await col()
      .find({ userId: new ObjectId(userId) })
      .sort({ name: 1 })
      .toArray();
    res.json({ items: docs });
  } catch (err) {
    logger.error(`listCategories error: ${(err as Error).message}`);
    next(err);
  }
}

/** POST /api/v1/auth/categories (JWT required) */
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

    const result = await col().insertOne(doc);
    res.status(201).json({ item: { ...doc, _id: result.insertedId } });
  } catch (err) {
    logger.error(`createCategory error: ${(err as Error).message}`);
    next(err);
  }
}