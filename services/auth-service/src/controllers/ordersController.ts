/**
 * Orders — guest (public, by restaurant subdomain + table) and staff (authenticated).
 * Pricing, orderability and status rules live in services/orders/core.ts.
 */
import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import { resolveBranchLocationId } from './categoriesController.js';
import { branchForUnnamed } from '../utils/branches.js';
import {
  OrderError,
  adjustEtaCore,
  createOrderCore,
  estimateForGuest,
  toAdminOrder,
  toPublicOrder,
  updateStatusCore,
} from '../services/orders/core.js';
import { eventPayload, openStream } from '../services/orders/events.js';
import type { OrderDoc, OrderStatus } from '../models/Order.js';

const ordersCol = () => client.db('authDB').collection<OrderDoc>('orders');

function sendOrderError(res: Response, e: unknown, next: NextFunction) {
  if (e instanceof OrderError) return res.fail(e.status, e.message, e.details);
  return next(e);
}

/* ------------------------------------------------------------------ guest (public) */

/**
 * POST /api/v1/public/orders — dine-in (table, pay at the counter) or online
 * (pickup: pay on collection · delivery: cash on delivery, with name/phone/address).
 */
export async function placePublicOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as {
      subdomain: string;
      branch?: string | null;
      channel?: 'dine-in' | 'online';
      table?: string | null;
      tableKey?: string | null;
      fulfillment?: 'pickup' | 'delivery' | null;
      customer?: { name?: string; phone?: string; address?: string | null } | null;
      items: Array<{ itemId: string; qty: number; variation?: string | null; modifiers?: any[]; notes?: string | null }>;
      notes?: string | null;
      sessionId?: string | null;
      idempotencyKey?: string | null;
      source?: 'ai-waiter' | 'menu';
    };
    const tenant = await client
      .db('authDB')
      .collection('tenants')
      .findOne({ subdomain: b.subdomain }, { projection: { _id: 1, restaurantInfo: 1 } });
    if (!tenant) return res.fail(404, 'Restaurant not found');
    const tenantOid = tenant._id as ObjectId;
    let locationId = b.branch ? await resolveBranchLocationId(tenantOid, b.branch) : null;
    if (b.branch && !locationId) return res.fail(404, 'Branch not found');
    if (!b.branch) {
      const unnamed = await branchForUnnamed(tenantOid);
      if (unnamed.mustChoose) return res.fail(409, 'Please choose a branch first.', { needs: 'branch' });
      locationId = unnamed.locationId;
    }
    const info = (tenant.restaurantInfo ?? {}) as { dineInEnabled?: boolean; onlineSalesEnabled?: boolean };
    if (b.channel === 'online' && info.onlineSalesEnabled === false) {
      return res.fail(409, "This restaurant isn't taking online orders.");
    }
    if (b.channel !== 'online' && info.dineInEnabled === false) {
      return res.fail(409, "This restaurant isn't taking dine-in orders.");
    }

    const { order, created } = await createOrderCore({
      tenantOid,
      locationId,
      branch: b.branch ?? null,
      channel: b.channel,
      table: b.table,
      tableKey: b.tableKey,
      fulfillment: b.fulfillment,
      customer: b.customer ? { ...b.customer, address: b.customer.address ?? undefined } : null,
      lines: b.items,
      notes: b.notes,
      source: b.source === 'ai-waiter' ? 'ai-waiter' : 'menu',
      sessionId: b.sessionId,
      idempotencyKey: b.idempotencyKey,
    });
    if (created) {
      const where = order.online ? order.online.fulfillment : `table=${order.dineIn?.tableNumber}`;
      logger.info(`ORDER placed #${order.orderNumber} tenant=${tenantOid} ${where} total=${order.total}`);
    }
    return res.ok({ order: toPublicOrder(order), created }, created ? 201 : 200);
  } catch (e) {
    return sendOrderError(res, e, next);
  }
}

/** GET /api/v1/public/orders/:token — the guest's order status. */
export async function getPublicOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const token = String(req.params.token || '');
    if (token.length < 20) return res.fail(404, 'Order not found');
    const order = await ordersCol().findOne({ publicToken: token });
    if (!order) return res.fail(404, 'Order not found');
    return res.ok({ order: toPublicOrder(order) });
  } catch (e) {
    return next(e);
  }
}

/** GET /api/v1/public/orders/:token/stream — live status updates (SSE). */
export async function streamPublicOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const token = String(req.params.token || '');
    const order = token.length >= 20 ? await ordersCol().findOne({ publicToken: token }) : null;
    if (!order) return res.fail(404, 'Order not found');
    openStream(req, res, `order:${token}`, { order: toPublicOrder(order) });
  } catch (e) {
    return next(e);
  }
}

/** POST /api/v1/public/wait-time — "how long would this take right now?" before ordering. */
export async function publicWaitTime(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as { subdomain: string; branch?: string | null; items: Array<{ itemId: string; qty: number; variation?: string | null }> };
    const tenant = await client.db('authDB').collection('tenants').findOne({ subdomain: b.subdomain }, { projection: { _id: 1 } });
    if (!tenant) return res.fail(404, 'Restaurant not found');
    const tenantOid = tenant._id as ObjectId;
    // no branch → the kitchen the order would go to (the only branch, or the main link's), as placing it decides
    const locationId = b.branch
      ? await resolveBranchLocationId(tenantOid, b.branch)
      : (await branchForUnnamed(tenantOid)).locationId;
    if (b.branch && !locationId) return res.fail(404, 'Branch not found');
    const estimate = await estimateForGuest({ tenantOid, locationId, items: b.items ?? [] });
    return res.ok({ estimate });
  } catch (e) {
    return sendOrderError(res, e, next);
  }
}

/* ------------------------------------------------------------------ staff (authenticated) */

function scopeLocation(req: Request): ObjectId | null {
  const loc = req.user?.locationId;
  return loc && ObjectId.isValid(loc) ? new ObjectId(loc) : null;
}

/** POST /api/v1/orders — staff enter an order for a table. */
export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');
    const b = req.body as { table: string; items: any[]; notes?: string; idempotencyKey?: string; locationId?: string };
    const tenantOid = new ObjectId(tenantId);
    // a branch session is its branch; otherwise the branch asked for — one of this restaurant's open branches — or,
    // without one, the branch orders without a branch go to (two or more and none chosen → staff must pick one)
    let locationId = scopeLocation(req);
    if (!locationId && b.locationId) {
      locationId = ObjectId.isValid(b.locationId) ? await resolveBranchLocationId(tenantOid, b.locationId) : null;
      if (!locationId) return res.fail(404, 'Branch not found');
    }
    if (!locationId) {
      const unnamed = await branchForUnnamed(tenantOid);
      if (unnamed.mustChoose) return res.fail(409, 'Choose the branch for this order first.', { needs: 'branch' });
      locationId = unnamed.locationId;
    }
    const { order, created } = await createOrderCore({
      tenantOid,
      locationId,
      table: b.table,
      lines: b.items,
      notes: b.notes,
      source: 'staff',
      idempotencyKey: b.idempotencyKey,
    });
    return res.ok({ order: toAdminOrder(order), created }, created ? 201 : 200);
  } catch (e) {
    return sendOrderError(res, e, next);
  }
}

/**
 * GET /api/v1/orders?view=all&from=YYYY-MM-DD&to=YYYY-MM-DD&q=&status=&channel=&skip=&limit= — the full order history:
 * any business days, search by order number / table / guest name or phone / dish, newest first, paged, with the count
 * and takings of everything that matches (cancelled orders don't count as takings).
 */
async function listOrderHistory(req: Request, res: Response, tenantId: string) {
  const q: Record<string, unknown> = { tenantId: new ObjectId(tenantId) };
  const loc = scopeLocation(req);
  if (loc) q.locationId = loc;
  // (the owner looking at one branch — a branch login is always kept to its own, whatever it asks)
  else if (typeof req.query.location === 'string' && ObjectId.isValid(req.query.location)) {
    q.locationId = new ObjectId(req.query.location);
  }
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = day(req.query.from);
  const to = day(req.query.to);
  if (from || to) q.businessDay = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const statuses: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];
  const status = String(req.query.status ?? '');
  if (status === 'open') q.status = { $in: ['placed', 'accepted', 'preparing', 'ready'] };
  else if ((statuses as string[]).includes(status)) q.status = status;
  const channel = String(req.query.channel ?? '');
  if (channel === 'dine-in' || channel === 'online') q.channel = channel;
  else if (channel === 'delivery' || channel === 'pickup') {
    q.channel = 'online';
    q['online.fulfillment'] = channel;
  }
  const text = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  if (text) {
    const rx = { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const num = Number(text.replace(/^#/, ''));
    q.$or = [
      ...(Number.isInteger(num) && num > 0 ? [{ orderNumber: num }] : []),
      { 'dineIn.tableNumber': text },
      { 'online.customer.name': rx },
      { 'online.customer.phone': rx },
      { 'items.name': rx },
    ];
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 2000);
  const skip = Math.max(0, Number(req.query.skip) || 0);
  const [docs, totals] = await Promise.all([
    ordersCol().find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    ordersCol()
      .aggregate<{ count: number; takings: number; cancelled: number }>([
        { $match: q },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            takings: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 0, '$total'] } },
            cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          },
        },
      ])
      .toArray(),
  ]);
  const t = totals[0] ?? { count: 0, takings: 0, cancelled: 0 };
  return res.ok({
    orders: docs.map(toAdminOrder),
    total: t.count,
    takings: Math.round(t.takings * 100) / 100,
    cancelled: t.cancelled,
  });
}

/** GET /api/v1/orders?view=active|history&limit= — the board. Branch sessions only see their branch. */
export async function listOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');
    if (req.query.view === 'all') return await listOrderHistory(req, res, tenantId);
    const view = req.query.view === 'history' ? 'history' : 'active';
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const q: Record<string, unknown> = { tenantId: new ObjectId(tenantId) };
    const loc = scopeLocation(req);
    if (loc) q.locationId = loc;
    if (view === 'active') {
      q.status = { $in: ['placed', 'accepted', 'preparing', 'ready'] };
    } else {
      q.status = { $in: ['completed', 'cancelled'] };
      q.createdAt = { $gte: new Date(Date.now() - 1000 * 60 * 60 * 48) };
    }
    const docs = await ordersCol().find(q).sort({ createdAt: view === 'active' ? 1 : -1 }).limit(limit).toArray();
    return res.ok({ orders: docs.map(toAdminOrder) });
  } catch (e) {
    return next(e);
  }
}

/** POST /api/v1/orders/:id/status { status } */
export async function updateOrderStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');
    const order = await updateStatusCore({
      tenantOid: new ObjectId(tenantId),
      orderId: String(req.params.id),
      to: (req.body as { status: OrderStatus }).status,
      by: req.user?.email || req.user?.id,
      locationId: scopeLocation(req),
    });
    return res.ok({ order: toAdminOrder(order) });
  } catch (e) {
    return sendOrderError(res, e, next);
  }
}

/** POST /api/v1/orders/:id/eta { addMinutes } — the kitchen pushes the ready time back (or forward). */
export async function adjustOrderEta(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');
    const order = await adjustEtaCore({
      tenantOid: new ObjectId(tenantId),
      orderId: String(req.params.id),
      addMinutes: (req.body as { addMinutes: number }).addMinutes,
      locationId: scopeLocation(req),
    });
    return res.ok({ order: toAdminOrder(order) });
  } catch (e) {
    return sendOrderError(res, e, next);
  }
}

/** GET /api/v1/orders/stream — live board events (SSE): orders and guests' service requests. Branch sessions get
 *  their branch only. */
export async function streamOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');
    const loc = scopeLocation(req);
    openStream(
      req,
      res,
      `tenant:${tenantId}`,
      { connectedAt: new Date().toISOString() },
      loc ? (ev) => String(eventPayload(ev).locationId ?? '') === loc.toHexString() : undefined,
    );
  } catch (e) {
    return next(e);
  }
}
