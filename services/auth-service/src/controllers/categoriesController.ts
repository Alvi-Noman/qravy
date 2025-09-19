import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { CategoryDoc } from '../models/Category.js';
import { toCategoryDTO } from '../utils/mapper.js';
import { auditLog } from '../utils/audit.js';
// ADD:
import type { TenantDoc } from '../models/Tenant.js';

function categoriesCol() {
  return client.db('authDB').collection<CategoryDoc>('categories');
}

function menuItemsCol() {
  return client.db('authDB').collection('menuItems');
}

// ADD:
function tenantsCol() {
  return client.db('authDB').collection<TenantDoc>('tenants');
}

function canWrite(role?: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');

    const docs = await categoriesCol()
      .find({ tenantId: new ObjectId(tenantId) })
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
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const { name } = req.body as { name: string };

    const now = new Date();
    const doc: CategoryDoc = {
      tenantId: new ObjectId(tenantId),
      createdBy: new ObjectId(userId),
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
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    // ADD: mark onboarding progress for category
    await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      { $set: { 'onboardingProgress.hasCategory': true, updatedAt: now } }
    );

    return res.ok({ item: toCategoryDTO(created) }, 201);
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 11000) {
      return res.fail(409, 'Category already exists.');
    }
    logger.error(`createCategory error: ${(err as Error).message}`);
    next(err);
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const { id } = req.params;
    const { name } = req.body as { name: string };
    if (!ObjectId.isValid(id)) return res.fail(400, 'Invalid id');

    const filter = { _id: new ObjectId(id), tenantId: new ObjectId(tenantId) };
    const before = await categoriesCol().findOne(filter);
    if (!before) return res.fail(404, 'Category not found');

    const doc = await categoriesCol().findOneAndUpdate(
      filter,
      { $set: { name, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!doc) return res.fail(404, 'Category not found');

    await auditLog({
      userId,
      action: 'CATEGORY_UPDATE',
      before: toCategoryDTO(before),
      after: toCategoryDTO(doc),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toCategoryDTO(doc) });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 11000) {
      return res.fail(409, 'Category already exists.');
    }
    logger.error(`updateCategory error: ${(err as Error).message}`);
    next(err);
  }
}

export async function deleteCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (!canWrite(req.user?.role)) return res.fail(403, 'Forbidden');

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.fail(400, 'Invalid id');

    const filter = { _id: new ObjectId(id), tenantId: new ObjectId(tenantId) };
    const cat = await categoriesCol().findOne(filter);
    if (!cat) return res.fail(404, 'Category not found');

    const delItems = await menuItemsCol().deleteMany({
      tenantId: new ObjectId(tenantId),
      category: cat.name,
    });

    await categoriesCol().deleteOne(filter);

    // ADD: recompute flags after deletion
    const [remainingCategories, remainingItems] = await Promise.all([
      categoriesCol().countDocuments({ tenantId: new ObjectId(tenantId) }),
      menuItemsCol().countDocuments({ tenantId: new ObjectId(tenantId) }),
    ]);

    await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      {
        $set: {
          'onboardingProgress.hasCategory': remainingCategories > 0,
          'onboardingProgress.hasMenuItem': remainingItems > 0,
          updatedAt: new Date(),
        },
      }
    );

    await auditLog({
      userId,
      action: 'CATEGORY_DELETE',
      before: toCategoryDTO(cat),
      metadata: { deletedProducts: delItems.deletedCount || 0 },
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    logger.info(
      `Category deleted: ${cat.name} for tenant ${tenantId}. Also deleted ${delItems.deletedCount || 0} menu items.`
    );

    return res.ok({ deleted: true, deletedProducts: delItems.deletedCount || 0 });
  } catch (err) {
    logger.error(`deleteCategory error: ${(err as Error).message}`);
    next(err);
  }
}