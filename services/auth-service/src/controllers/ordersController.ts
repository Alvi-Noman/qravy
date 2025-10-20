import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { orderCreateSchema } from '../validation/schemas.js';

function menuItemsCol() { return client.db('authDB').collection('menuItems'); }
function ordersCol()    { return client.db('authDB').collection('orders'); }

const visKey = (ch: 'dine-in' | 'online') => (ch === 'dine-in' ? 'dineIn' : 'online');

export const createOrderValidators = [validateRequest(orderCreateSchema)];

export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');

    const {
      channel, items, tableNumber, customer, notes,
    } = req.body as {
      channel: 'dine-in' | 'online';
      items: Array<{ id: string; qty: number; variation?: string; notes?: string }>;
      tableNumber?: string;
      customer?: { name: string; phone: string; address: string };
      notes?: string;
    };

    const tenantOid = new ObjectId(tenantId);

    // Verify items exist and are baseline-visible for the requested channel
    const itemOids = items.map(i => new ObjectId(i.id));
    const docs = await menuItemsCol()
      .find({ _id: { $in: itemOids }, tenantId: tenantOid })
      .project({ name: 1, visibility: 1, variations: 1 })
      .toArray();

    const byId = new Map(docs.map(d => [d._id!.toString(), d]));
    const key = visKey(channel);

    for (const line of items) {
      const d = byId.get(line.id);
      if (!d) return res.fail(400, `Item not found: ${line.id}`);
      const baseVisible = (d.visibility?.[key as 'dineIn' | 'online']) !== false; // default true
      if (!baseVisible) return res.fail(400, `Item "${d.name}" is not available for ${channel}`);
      if (line.variation) {
        const ok = Array.isArray(d.variations) && d.variations.some(v => v?.name === line.variation);
        if (!ok) return res.fail(400, `Invalid variation for "${d.name}": ${line.variation}`);
      }
    }

    const now = new Date();
    const orderDoc: any = {
      tenantId: tenantOid,
      channel,
      status: 'placed', // draft|placed|paid|preparing|completed|cancelled
      items: items.map(l => ({
        itemId: new ObjectId(l.id),
        qty: l.qty,
        variation: l.variation,
        notes: l.notes,
      })),
      notes,
      dineIn: channel === 'dine-in' ? { tableNumber: tableNumber ?? 'unknown' } : undefined,
      online: channel === 'online' ? { customer } : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const result = await ordersCol().insertOne(orderDoc);
    logger.info(`ORDER created ${result.insertedId.toString()} channel=${channel}`);

    return res.ok({ id: result.insertedId.toString(), status: 'placed' }, 201);
  } catch (err) {
    logger.error(`createOrder error: ${(err as Error).message}`);
    next(err);
  }
}
