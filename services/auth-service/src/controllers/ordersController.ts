/**
 * Orders — guest (public, by restaurant subdomain + table) and staff (authenticated).
 * Pricing, orderability and status rules live in services/orders/core.ts.
 */
import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import { resolveBranchLocationId } from './categoriesController.js';
import {
  OrderError,
  adjustEtaCore,
  createOrderCore,
  estimateForGuest,
  toAdminOrder,
  toPublicOrder,
  updateStatusCore,
} from '../services/orders/core.js';
import { openStream } from '../services/orders/events.js';
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
    const locationId = b.branch ? await resolveBranchLocationId(tenantOid, b.branch) : null;
    if (b.branch && !locationId) return res.fail(404, 'Branch not found');
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
    const locationId = b.branch ? await resolveBranchLocationId(tenantOid, b.branch) : null;
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
    const locationId =
      scopeLocation(req) ?? (b.locationId && ObjectId.isValid(b.locationId) ? new ObjectId(b.locationId) : null);
    const { order, created } = await createOrderCore({
      tenantOid: new ObjectId(tenantId),
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

/** GET /api/v1/orders?view=active|history&limit= — the board. Branch sessions only see their branch. */
export async function listOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(409, 'Tenant not set');
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

/** GET /api/v1/orders/stream — live board events (SSE). Branch sessions get their branch only. */
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
      loc ? (ev) => String(ev.order.locationId ?? '') === loc.toHexString() : undefined,
    );
  } catch (e) {
    return next(e);
  }
}
