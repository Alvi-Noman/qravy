import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  const userId = req.params.id;

  if (!ObjectId.isValid(userId)) {
    return res.fail(400, 'Invalid user id');
  }

  const db = client.db('authDB');
  const users = db.collection('users');
  const tenants = db.collection('tenants');
  const memberships = db.collection('memberships');
  const menuItems = db.collection('menuItems');
  const categories = db.collection('categories');

  const session = client.startSession();

  try {
    await session.withTransaction(async () => {
      // Find user
      const user = await users.findOne({ _id: new ObjectId(userId) }, { session });
      if (!user) {
        throw new Error('User not found');
      }

      // Find tenants owned by this user
      const ownedTenants = await tenants.find({ ownerId: new ObjectId(userId) }, { session }).toArray();

      for (const tenant of ownedTenants) {
        // Delete related data for each tenant
        await memberships.deleteMany({ tenantId: tenant._id }, { session });
        await menuItems.deleteMany({ tenantId: tenant._id }, { session });
        await categories.deleteMany({ tenantId: tenant._id }, { session });

        // Delete tenant
        await tenants.deleteOne({ _id: tenant._id }, { session });

        logger.info(`Deleted tenant ${tenant._id} belonging to user ${userId}`);
      }

      // Finally delete user
      await users.deleteOne({ _id: new ObjectId(userId) }, { session });
    });

    return res.ok({ message: 'User and related tenants removed.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`deleteUser error: ${msg}`);
    next(err);
  } finally {
    await session.endSession();
  }
}