/**
 * The restaurant's own riders — the list staff keep (Riders page), handing a delivery order to one (the order board),
 * and the rider's own page (/rider/<link>, no login): Picked up → Delivered, or "couldn't deliver".
 *
 * The order's status stays the kitchen's flow: "Picked up" moves it to ready if the kitchen hadn't marked it (the
 * food has left), "Delivered" to completed. Cash on delivery: the rider took the total at the door (the order is then
 * paid) and holds it until staff mark it handed in.
 */
import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { client } from '../../db.js';
import { DEFAULT_TIMEZONE } from '../../utils/availability.js';
import type { OrderDoc, OrderStatus } from '../../models/Order.js';
import type { RiderDoc, RiderVehicle } from '../../models/Rider.js';
import { OrderError, businessDay, toAdminOrder, toPublicOrder } from './core.js';
import { publishOrder, publishRider, publishTenant } from './events.js';

const ridersCol = () => client.db('authDB').collection<RiderDoc>('riders');
const ordersCol = () => client.db('authDB').collection<OrderDoc>('orders');

/** How long after delivery the rider still sees the customer's phone and address */
export const RIDER_SEES_CUSTOMER_MS = 60 * 60 * 1000;
/** Reasons a rider can give for "couldn't deliver" (the page shows them in the rider's language) */
export const PROBLEM_REASONS = ['no-answer', 'wrong-address', 'refused', 'other'] as const;

const newLinkToken = () => randomBytes(18).toString('base64url');

const oid = (id: string, what = 'id') => {
  if (!ObjectId.isValid(id)) throw new OrderError(400, `Invalid ${what}`);
  return new ObjectId(id);
};

/* ------------------------------------------------------------------ the list (staff) */

export type RiderInput = {
  name?: string;
  phone?: string;
  photoUrl?: string | null;
  vehicle?: RiderVehicle | null;
  locationId?: string | null;
  onDuty?: boolean;
};

/** The riders a staff session may see: its branch's riders and the ones for every branch (owners/admins: all). */
function scopeFilter(tenantOid: ObjectId, locationId?: ObjectId | null) {
  const f: Record<string, unknown> = { tenantId: tenantOid, removedAt: null };
  if (locationId) f.$or = [{ locationId }, { locationId: null }, { locationId: { $exists: false } }];
  return f;
}

/** Each rider with today's numbers: deliveries done, the ones they're on now, the cash they're holding. */
export async function listRiders(tenantOid: ObjectId, locationId?: ObjectId | null) {
  const riders = await ridersCol().find(scopeFilter(tenantOid, locationId)).sort({ onDuty: -1, name: 1 }).toArray();
  if (!riders.length) return [];
  const tenant = await client.db('authDB').collection('tenants').findOne({ _id: tenantOid }, { projection: { timezone: 1 } });
  const today = businessDay((tenant?.timezone as string) || DEFAULT_TIMEZONE);
  const ids = riders.map((r) => r._id!);
  const orders = await ordersCol()
    .find(
      {
        tenantId: tenantOid,
        'delivery.riderId': { $in: ids },
        $or: [
          { businessDay: today },
          { 'delivery.deliveredAt': null, status: { $nin: ['completed', 'cancelled'] } },
          { 'delivery.cashCollected': { $gt: 0 }, 'delivery.cashSettledAt': null },
        ],
      },
      { projection: { delivery: 1, status: 1, businessDay: 1, orderNumber: 1 } },
    )
    .toArray();
  return riders.map((r) => {
    const mine = orders.filter((o) => String(o.delivery?.riderId) === String(r._id));
    const active = mine.filter((o) => !o.delivery?.deliveredAt && o.status !== 'completed' && o.status !== 'cancelled');
    return {
      ...riderView(r),
      deliveredToday: mine.filter((o) => o.businessDay === today && o.delivery?.deliveredAt).length,
      active: active.map((o) => ({ orderNumber: o.orderNumber, pickedUp: !!o.delivery?.pickedUpAt })),
      cashHolding: mine.reduce((n, o) => n + (o.delivery?.cashSettledAt ? 0 : o.delivery?.cashCollected ?? 0), 0),
    };
  });
}

export function riderView(r: RiderDoc) {
  return {
    id: String(r._id),
    name: r.name,
    phone: r.phone,
    photoUrl: r.photoUrl ?? null,
    vehicle: r.vehicle ?? null,
    locationId: r.locationId ? String(r.locationId) : null,
    onDuty: !!r.onDuty,
    linkToken: r.linkToken,
    cashHandedAt: r.cashHandedAt ?? null,
  };
}

export async function createRider(tenantOid: ObjectId, input: RiderInput) {
  const now = new Date();
  const doc: RiderDoc = {
    tenantId: tenantOid,
    locationId: input.locationId ? oid(input.locationId, 'branch') : null,
    name: String(input.name || '').trim(),
    phone: String(input.phone || '').trim(),
    photoUrl: input.photoUrl || null,
    vehicle: input.vehicle || null,
    onDuty: input.onDuty !== false,
    linkToken: newLinkToken(),
    createdAt: now,
    updatedAt: now,
    removedAt: null,
  };
  if (!doc.name || !doc.phone) throw new OrderError(400, 'A rider needs a name and a phone number.');
  const { insertedId } = await ridersCol().insertOne(doc);
  return riderView({ ...doc, _id: insertedId });
}

async function ownRider(tenantOid: ObjectId, riderId: string, locationId?: ObjectId | null) {
  const r = await ridersCol().findOne({ ...scopeFilter(tenantOid, locationId), _id: oid(riderId, 'rider') });
  if (!r) throw new OrderError(404, 'Rider not found');
  return r;
}

export async function updateRider(tenantOid: ObjectId, riderId: string, input: RiderInput, locationId?: ObjectId | null) {
  const r = await ownRider(tenantOid, riderId, locationId);
  const set: Partial<RiderDoc> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = String(input.name).trim();
  if (input.phone !== undefined) set.phone = String(input.phone).trim();
  if (input.photoUrl !== undefined) set.photoUrl = input.photoUrl || null;
  if (input.vehicle !== undefined) set.vehicle = input.vehicle || null;
  if (input.locationId !== undefined) set.locationId = input.locationId ? oid(input.locationId, 'branch') : null;
  if (input.onDuty !== undefined) set.onDuty = !!input.onDuty;
  if (set.name === '' || set.phone === '') throw new OrderError(400, 'A rider needs a name and a phone number.');
  await ridersCol().updateOne({ _id: r._id }, { $set: set });
  return riderView({ ...r, ...set });
}

/** Removed: off the list, and their link stops working. Past orders keep their name. */
export async function removeRider(tenantOid: ObjectId, riderId: string, locationId?: ObjectId | null) {
  const r = await ownRider(tenantOid, riderId, locationId);
  const now = new Date();
  await ridersCol().updateOne({ _id: r._id }, { $set: { removedAt: now, onDuty: false, linkToken: newLinkToken(), updatedAt: now } });
  publishRider(String(r._id));
}

/** A new link (a lost phone): the old one stops working at once. */
export async function resetRiderLink(tenantOid: ObjectId, riderId: string, locationId?: ObjectId | null) {
  const r = await ownRider(tenantOid, riderId, locationId);
  const linkToken = newLinkToken();
  await ridersCol().updateOne({ _id: r._id }, { $set: { linkToken, updatedAt: new Date() } });
  publishRider(String(r._id)); // (the page on the old link finds nothing on its next load)
  return riderView({ ...r, linkToken });
}

/** The cash the rider is holding is handed in: their delivered cash orders are marked settled. */
export async function settleRiderCash(tenantOid: ObjectId, riderId: string, by?: string, locationId?: ObjectId | null) {
  const r = await ownRider(tenantOid, riderId, locationId);
  const now = new Date();
  const { modifiedCount } = await ordersCol().updateMany(
    { tenantId: tenantOid, 'delivery.riderId': r._id, 'delivery.cashCollected': { $gt: 0 }, 'delivery.cashSettledAt': null },
    { $set: { 'delivery.cashSettledAt': now, updatedAt: now } },
  );
  await ridersCol().updateOne({ _id: r._id }, { $set: { cashHandedAt: now, updatedAt: now } });
  return { settledOrders: modifiedCount, at: now, by };
}

/* ------------------------------------------------------------------ an order's trip */

function publishAll(doc: OrderDoc, riderIds: Array<ObjectId | undefined | null>) {
  publishTenant(doc.tenantId.toHexString(), { type: 'order.updated', order: toAdminOrder(doc) });
  publishOrder(doc.publicToken, { type: 'order.updated', order: toPublicOrder(doc) });
  for (const id of riderIds) if (id) publishRider(String(id));
}

const asDoc = (r: unknown) => ((r as { value?: OrderDoc })?.value ?? (r as OrderDoc | null)) || null;

async function deliveryOrder(tenantOid: ObjectId, orderId: string, locationId?: ObjectId | null) {
  const filter: Record<string, unknown> = { _id: oid(orderId, 'order id'), tenantId: tenantOid };
  if (locationId) filter.locationId = locationId;
  const o = await ordersCol().findOne(filter);
  if (!o) throw new OrderError(404, 'Order not found');
  if (o.channel !== 'online' || o.online?.fulfillment !== 'delivery') throw new OrderError(409, 'Only delivery orders go to a rider.');
  return o;
}

/** Staff hand a delivery order to a rider (or take it back: riderId null). Changing the rider is fine until pickup. */
export async function assignRider(opts: { tenantOid: ObjectId; orderId: string; riderId: string | null; by?: string; locationId?: ObjectId | null }) {
  const o = await deliveryOrder(opts.tenantOid, opts.orderId, opts.locationId);
  if (o.status === 'completed' || o.status === 'cancelled') throw new OrderError(409, 'This order is already closed.');
  if (o.delivery?.pickedUpAt) throw new OrderError(409, 'The rider has already picked this order up.');
  const before = o.delivery?.riderId;
  let delivery: OrderDoc['delivery'] = null;
  if (opts.riderId) {
    const r = await ridersCol().findOne({ _id: oid(opts.riderId, 'rider'), tenantId: opts.tenantOid, removedAt: null });
    if (!r) throw new OrderError(404, 'Rider not found');
    if (r.locationId && o.locationId && String(r.locationId) !== String(o.locationId)) {
      throw new OrderError(409, `${r.name} rides for another branch.`);
    }
    delivery = {
      riderId: r._id!,
      name: r.name,
      phone: r.phone,
      photoUrl: r.photoUrl ?? null,
      vehicle: r.vehicle ?? null,
      assignedAt: new Date(),
      ...(opts.by ? { assignedBy: opts.by } : {}),
      pickedUpAt: null,
      deliveredAt: null,
      problem: null,
    };
  }
  const doc = asDoc(
    await ordersCol().findOneAndUpdate(
      { _id: o._id, 'delivery.pickedUpAt': null }, // (null also matches no rider yet)
      { $set: { delivery, updatedAt: new Date() } },
      { returnDocument: 'after' },
    ),
  );
  if (!doc) throw new OrderError(409, 'This order was just updated — refresh and try again.');
  publishAll(doc, [before, delivery?.riderId]);
  return doc;
}

export type TripAction = 'picked_up' | 'delivered' | 'problem';

/** What one tap changes on the order (pure — unit-tested): the fields to set and the status steps to record.
 *  null = nothing to do (a double "Delivered"). */
export function tripChanges(
  o: Pick<OrderDoc, 'status' | 'delivery' | 'payment' | 'total'>,
  action: TripAction,
  extra: { reason?: string; note?: string; by?: string },
  now: Date,
): { set: Record<string, unknown>; history: Array<{ status: OrderStatus; at: Date; by?: string }> } | null {
  if (!o.delivery) throw new OrderError(409, 'No rider on this order yet.');
  if (o.status === 'cancelled') throw new OrderError(409, 'This order was cancelled.');
  const set: Record<string, unknown> = { updatedAt: now };
  const history: Array<{ status: OrderStatus; at: Date; by?: string }> = [];
  const by = extra.by ? { by: extra.by } : {};
  if (action === 'problem') {
    if (o.delivery.deliveredAt) throw new OrderError(409, 'Already delivered.');
    set['delivery.problem'] = { reason: extra.reason || 'other', ...(extra.note ? { note: extra.note.slice(0, 300) } : {}), at: now };
  } else if (action === 'picked_up') {
    if (o.delivery.deliveredAt) throw new OrderError(409, 'Already delivered.');
    if (!o.delivery.pickedUpAt) set['delivery.pickedUpAt'] = now;
    set['delivery.problem'] = null;
    // the food has left the kitchen: ready, if the kitchen hadn't marked it
    if (o.status === 'placed' || o.status === 'accepted' || o.status === 'preparing') {
      set.status = 'ready';
      history.push({ status: 'ready', at: now, ...by });
    }
  } else {
    if (o.delivery.deliveredAt) return null; // (a double tap)
    if (!o.delivery.pickedUpAt) set['delivery.pickedUpAt'] = now;
    set['delivery.deliveredAt'] = now;
    set['delivery.problem'] = null;
    // cash on delivery: the rider took the total at the door
    if (o.payment.method === 'cod' && o.payment.status === 'unpaid') {
      set['delivery.cashCollected'] = o.total;
      set['delivery.cashSettledAt'] = null;
      set['payment.status'] = 'paid';
    }
    if (o.status !== 'completed') {
      if (o.status !== 'ready') history.push({ status: 'ready', at: now, ...by });
      set.status = 'completed';
      history.push({ status: 'completed', at: now, ...by });
    }
  }
  return { set, history };
}

/** Picked up / Delivered / couldn't deliver — from the rider's page, or staff doing it for them. */
async function moveTrip(o: OrderDoc, action: TripAction, extra: { reason?: string; note?: string; by?: string }) {
  const change = tripChanges(o, action, extra, new Date());
  if (!change) return o;
  const { set, history } = change;
  const doc = asDoc(
    await ordersCol().findOneAndUpdate(
      { _id: o._id, status: o.status, 'delivery.riderId': o.delivery!.riderId },
      { $set: set, ...(history.length ? { $push: { statusHistory: { $each: history } } } : {}) },
      { returnDocument: 'after' },
    ),
  );
  if (!doc) throw new OrderError(409, 'This order was just updated — refresh and try again.');
  publishAll(doc, [doc.delivery?.riderId]);
  return doc;
}

/** Staff do a rider's step for them (they forgot to tap). */
export async function staffTripAction(opts: { tenantOid: ObjectId; orderId: string; action: TripAction; by?: string; locationId?: ObjectId | null }) {
  const o = await deliveryOrder(opts.tenantOid, opts.orderId, opts.locationId);
  return moveTrip(o, opts.action, { by: opts.by });
}

/* ------------------------------------------------------------------ the rider's own page (no login) */

async function riderByLink(token: string) {
  if (!token || token.length < 20) return null;
  return ridersCol().findOne({ linkToken: token, removedAt: null });
}

/** What the rider's page shows: who they are, their deliveries now (with the customer), and today's done ones
 *  (without the customer an hour after delivery). */
export async function riderPage(token: string) {
  const r = await riderByLink(token);
  if (!r) return null;
  const tenant = await client.db('authDB').collection('tenants').findOne({ _id: r.tenantId }, { projection: { name: 1, timezone: 1, subdomain: 1 } });
  const today = businessDay((tenant?.timezone as string) || DEFAULT_TIMEZONE);
  const orders = await ordersCol()
    .find({
      tenantId: r.tenantId,
      'delivery.riderId': r._id,
      $or: [{ 'delivery.deliveredAt': null, status: { $ne: 'cancelled' } }, { businessDay: today }],
    })
    .sort({ 'delivery.assignedAt': -1 })
    .limit(40)
    .toArray();
  const now = Date.now();
  return {
    restaurant: { name: (tenant?.name as string) || '', subdomain: (tenant?.subdomain as string) || '' },
    rider: { name: r.name, onDuty: !!r.onDuty, vehicle: r.vehicle ?? null },
    deliveries: orders
      .filter((o) => o.status !== 'cancelled')
      .map((o) => {
        const d = o.delivery!;
        const showCustomer = !d.deliveredAt || now - new Date(d.deliveredAt).getTime() < RIDER_SEES_CUSTOMER_MS;
        const c = o.online?.customer;
        return {
          id: String(o._id),
          orderNumber: o.orderNumber,
          status: o.status,
          items: o.items.reduce((n, l) => n + l.qty, 0),
          total: o.total,
          // what to collect at the door (nothing when it's paid)
          collect: o.payment.method === 'cod' && o.payment.status === 'unpaid' ? o.total : 0,
          cashCollected: d.cashCollected ?? 0,
          notes: o.notes ?? '',
          branch: o.branch ?? null,
          customer: showCustomer && c ? { name: c.name, phone: c.phone, address: c.address ?? '' } : null,
          assignedAt: d.assignedAt,
          pickedUpAt: d.pickedUpAt ?? null,
          deliveredAt: d.deliveredAt ?? null,
          problem: d.problem ?? null,
        };
      }),
  };
}

export async function riderIdForLink(token: string): Promise<string | null> {
  const r = await riderByLink(token);
  return r ? String(r._id) : null;
}

/** The rider taps Picked up / Delivered / Couldn't deliver on their page. */
export async function riderTripAction(token: string, orderId: string, action: TripAction, extra: { reason?: string; note?: string }) {
  const r = await riderByLink(token);
  if (!r) throw new OrderError(404, 'This link no longer works. Ask the restaurant for a new one.');
  const o = await ordersCol().findOne({ _id: oid(orderId, 'order id'), tenantId: r.tenantId, 'delivery.riderId': r._id });
  if (!o) throw new OrderError(404, 'This delivery is no longer yours.');
  return moveTrip(o, action, { ...extra, by: `rider:${r.name}` });
}
