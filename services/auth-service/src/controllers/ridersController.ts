/**
 * Riders — staff keep the list and hand delivery orders to them; the rider's own page (no login, by their private
 * link) marks Picked up / Delivered. Rules live in services/orders/riders.ts.
 */
import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import {
  assignRider,
  createRider,
  listRiders,
  removeRider,
  resetRiderLink,
  riderIdForLink,
  riderPage,
  riderTripAction,
  settleRiderCash,
  staffTripAction,
  updateRider,
  type TripAction,
} from '../services/orders/riders.js';
import { OrderError, toAdminOrder } from '../services/orders/core.js';
import { openStream } from '../services/orders/events.js';

function fail(res: Response, e: unknown, next: NextFunction) {
  if (e instanceof OrderError) return res.fail(e.status, e.message);
  return next(e);
}

const tenantOf = (req: Request) => {
  const t = req.user?.tenantId;
  if (!t) throw new OrderError(409, 'Tenant not set');
  return new ObjectId(t);
};
/** A branch session sees its branch's riders (and the ones for every branch) */
const branchOf = (req: Request): ObjectId | null => {
  const loc = req.user?.locationId; // (as the orders board: middleware/scope.ts sets it)
  return loc && ObjectId.isValid(loc) ? new ObjectId(loc) : null;
};
const who = (req: Request) => req.user?.email || req.user?.id;

/* ---------- staff ---------- */

export async function getRiders(req: Request, res: Response, next: NextFunction) {
  try {
    return res.ok({ riders: await listRiders(tenantOf(req), branchOf(req)) });
  } catch (e) {
    return fail(res, e, next);
  }
}

export async function postRider(req: Request, res: Response, next: NextFunction) {
  try {
    return res.ok({ rider: await createRider(tenantOf(req), req.body) });
  } catch (e) {
    return fail(res, e, next);
  }
}

export async function patchRider(req: Request, res: Response, next: NextFunction) {
  try {
    return res.ok({ rider: await updateRider(tenantOf(req), String(req.params.id), req.body, branchOf(req)) });
  } catch (e) {
    return fail(res, e, next);
  }
}

export async function deleteRider(req: Request, res: Response, next: NextFunction) {
  try {
    await removeRider(tenantOf(req), String(req.params.id), branchOf(req));
    return res.ok({ removed: true });
  } catch (e) {
    return fail(res, e, next);
  }
}

export async function postResetRiderLink(req: Request, res: Response, next: NextFunction) {
  try {
    return res.ok({ rider: await resetRiderLink(tenantOf(req), String(req.params.id), branchOf(req)) });
  } catch (e) {
    return fail(res, e, next);
  }
}

export async function postSettleCash(req: Request, res: Response, next: NextFunction) {
  try {
    return res.ok(await settleRiderCash(tenantOf(req), String(req.params.id), who(req), branchOf(req)));
  } catch (e) {
    return fail(res, e, next);
  }
}

/** POST /orders/:id/rider { riderId | null } */
export async function postOrderRider(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await assignRider({
      tenantOid: tenantOf(req),
      orderId: String(req.params.id),
      riderId: (req.body as { riderId: string | null }).riderId,
      by: who(req),
      locationId: branchOf(req),
    });
    return res.ok({ order: toAdminOrder(doc) });
  } catch (e) {
    return fail(res, e, next);
  }
}

/** POST /orders/:id/trip { action } — staff do the rider's step for them */
export async function postOrderTrip(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await staffTripAction({
      tenantOid: tenantOf(req),
      orderId: String(req.params.id),
      action: (req.body as { action: TripAction }).action,
      by: who(req),
      locationId: branchOf(req),
    });
    return res.ok({ order: toAdminOrder(doc) });
  } catch (e) {
    return fail(res, e, next);
  }
}

/* ---------- the rider's page (no login: the private link is the key) ---------- */

export async function getRiderPage(req: Request, res: Response, next: NextFunction) {
  try {
    const page = await riderPage(String(req.params.token || ''));
    if (!page) return res.fail(404, 'This link no longer works. Ask the restaurant for a new one.');
    res.setHeader('Cache-Control', 'no-store');
    return res.ok(page);
  } catch (e) {
    return fail(res, e, next);
  }
}

/** Live: the page reloads its deliveries when something changes (assigned, taken away, updated). */
export async function streamRiderPage(req: Request, res: Response, next: NextFunction) {
  try {
    const id = await riderIdForLink(String(req.params.token || ''));
    if (!id) return res.fail(404, 'This link no longer works.');
    openStream(req, res, `rider:${id}`, { connectedAt: new Date().toISOString() });
  } catch (e) {
    return fail(res, e, next);
  }
}

export async function postRiderTrip(req: Request, res: Response, next: NextFunction) {
  try {
    const { action, reason, note } = req.body as { action: TripAction; reason?: string; note?: string };
    await riderTripAction(String(req.params.token || ''), String(req.params.orderId), action, { reason, note });
    const page = await riderPage(String(req.params.token || ''));
    return res.ok(page ?? {});
  } catch (e) {
    return fail(res, e, next);
  }
}
