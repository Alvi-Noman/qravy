/**
 * Placing an order: the single place where money is decided.
 * Everything the client sends is treated as a *request* — prices, names and add-ons are
 * recomputed from the menu, and orderability (hours, sold-out, service periods…) is re-checked.
 */
import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { client } from '../../db.js';
import { checkOrderable } from '../../utils/orderability.js';
import { resolveModifierSelections, type ModifierSelection } from '../../utils/modifiers.js';
import { DEFAULT_TIMEZONE } from '../../utils/availability.js';
import type { Fulfillment, OrderChannel, OrderCustomer, OrderDoc, OrderLine, OrderStatus } from '../../models/Order.js';
import type { OrderEta } from '../../models/Order.js';
import { publishOrder, publishTenant } from './events.js';
import {
  DEFAULT_PREP_MINUTES,
  STALE_ORDER_MS,
  busyLevel,
  isForgotten,
  dishMinutes,
  estimate,
  kitchenSettings,
  minutesLeft,
  orderPrepMinutes,
  queueMinutes,
  type KitchenSettings,
  type QueuedOrder,
  type TimedItem,
} from './waitTime.js';

export const MAX_LINES = 50;
export const MAX_QTY = 50;

export type RequestedLine = {
  itemId: string;
  qty: number;
  variation?: string | null;
  /** From the cart: [{groupId, optionId}] — or already grouped [{groupId, optionIds}] */
  modifiers?: Array<{ groupId: string; optionId?: string; optionIds?: string[] }>;
  notes?: string | null;
};

export class OrderError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

const ordersCol = () => client.db('authDB').collection<OrderDoc>('orders');
const itemsCol = () => client.db('authDB').collection('menuItems');
const countersCol = () => client.db('authDB').collection<{ _id: string; seq: number }>('orderCounters');

const round2 = (n: number) => Math.round(n * 100) / 100;

function businessDay(tz: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function groupSelections(mods: RequestedLine['modifiers']): ModifierSelection[] {
  const by = new Map<string, string[]>();
  for (const m of mods ?? []) {
    if (!m || typeof m.groupId !== 'string') continue;
    const ids = [...(m.optionIds ?? []), ...(m.optionId ? [m.optionId] : [])].filter((x) => typeof x === 'string');
    by.set(m.groupId, [...(by.get(m.groupId) ?? []), ...ids]);
  }
  return [...by.entries()].map(([groupId, optionIds]) => ({ groupId, optionIds }));
}

/** Price every line from the menu (never from the client). Throws OrderError with a guest-friendly message. */
export async function priceLines(opts: {
  tenantOid: ObjectId;
  locationId: ObjectId | null;
  lines: RequestedLine[];
  /** Minutes for dishes without a time of their own */
  defaultPrepMinutes?: number;
  channel?: OrderChannel;
}): Promise<OrderLine[]> {
  const { tenantOid, locationId, lines } = opts;
  const channel = opts.channel ?? 'dine-in';
  if (!lines.length) throw new OrderError(400, 'Your order is empty.');
  if (lines.length > MAX_LINES) throw new OrderError(400, 'That order has too many lines.');

  const ids = lines.map((l) => {
    if (!ObjectId.isValid(l.itemId)) throw new OrderError(400, 'An item in your order no longer exists.');
    return new ObjectId(l.itemId);
  });
  const docs = await itemsCol()
    .find(
      { _id: { $in: ids }, tenantId: tenantOid },
      { projection: { name: 1, price: 1, status: 1, hidden: 1, visibility: 1, variations: 1, modifierGroups: 1, locationId: 1, prepMinutes: 1 } }
    )
    .toArray();
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const priced: OrderLine[] = [];
  for (const line of lines) {
    const d = byId.get(line.itemId);
    if (!d || d.status === 'hidden' || d.hidden) throw new OrderError(409, 'An item in your order is no longer on the menu.');
    if (channel === 'dine-in' && d.visibility?.dineIn === false) throw new OrderError(409, `${d.name} isn't served for dine-in.`);
    if (channel === 'online' && d.visibility?.online === false) throw new OrderError(409, `${d.name} isn't available for online orders.`);
    if (d.locationId && locationId && String(d.locationId) !== String(locationId)) {
      throw new OrderError(409, `${d.name} isn't available at this branch.`);
    }
    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) throw new OrderError(400, `Please check the quantity of ${d.name}.`);

    let base = Number(d.price ?? 0);
    let variation: string | undefined;
    const variations: Array<{ name?: string; price?: number }> = Array.isArray(d.variations) ? d.variations : [];
    if (variations.length) {
      const want = String(line.variation ?? '').trim().toLowerCase();
      const v = variations.find((x) => String(x.name ?? '').trim().toLowerCase() === want);
      if (!v) {
        const names = variations.map((x) => x.name).filter(Boolean).join(' / ');
        throw new OrderError(409, `Please choose a size for ${d.name} (${names}).`, { itemId: line.itemId, needs: 'variation' });
      }
      variation = String(v.name);
      if (typeof v.price === 'number') base = v.price;
    }

    let modifiers: OrderLine['modifiers'];
    try {
      modifiers = resolveModifierSelections(d.modifierGroups, groupSelections(line.modifiers));
    } catch (e) {
      throw new OrderError(409, `${d.name}: ${(e as Error).message}`, { itemId: line.itemId, needs: 'modifiers' });
    }
    const unit = round2(base + modifiers.reduce((s, m) => s + (m.price || 0), 0));
    priced.push({
      itemId: d._id as ObjectId,
      name: String(d.name),
      qty,
      ...(variation ? { variation } : {}),
      basePrice: round2(base),
      modifiers,
      unitPrice: unit,
      lineTotal: round2(unit * qty),
      ...(line.notes && String(line.notes).trim() ? { notes: String(line.notes).trim().slice(0, 300) } : {}),
      prepMinutes: dishMinutes(d as TimedItem, variation, opts.defaultPrepMinutes).minutes,
    });
  }

  // Hours, service periods, item hours, date ranges, sold-out — the server has the final word
  const orderable = await checkOrderable({ tenantOid, itemIds: ids, locationId, channel });
  for (const [, r] of orderable) {
    if (!r.ok) throw new OrderError(409, r.message, { reason: r.reason });
  }
  return priced;
}

async function nextOrderNumber(tenantOid: ObjectId, day: string): Promise<number> {
  const res = await countersCol().findOneAndUpdate(
    { _id: `${tenantOid.toHexString()}:${day}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  // driver v5 returns the doc, v4 returns { value }
  const doc = (res as unknown as { value?: { seq: number } })?.value ?? (res as unknown as { seq: number } | null);
  return doc?.seq ?? 1;
}

export async function createOrderCore(input: {
  tenantOid: ObjectId;
  locationId: ObjectId | null;
  branch?: string | null;
  /** Default dine-in */
  channel?: OrderChannel;
  /** Dine-in: required */
  table?: string | null;
  /** Online: required */
  fulfillment?: Fulfillment | null;
  customer?: Partial<OrderCustomer> | null;
  lines: RequestedLine[];
  notes?: string | null;
  source: OrderDoc['source'];
  sessionId?: string | null;
  idempotencyKey?: string | null;
}): Promise<{ order: OrderDoc; created: boolean }> {
  const channel: OrderChannel = input.channel === 'online' ? 'online' : 'dine-in';
  let dineIn: OrderDoc['dineIn'] = null;
  let online: OrderDoc['online'] = null;
  if (channel === 'dine-in') {
    const table = String(input.table ?? '').trim().slice(0, 20);
    if (!table) throw new OrderError(400, 'Which table are you at?', { needs: 'table' });
    dineIn = { tableNumber: table };
  } else {
    const fulfillment: Fulfillment = input.fulfillment === 'delivery' ? 'delivery' : 'pickup';
    const name = String(input.customer?.name ?? '').trim().slice(0, 80);
    const phone = String(input.customer?.phone ?? '').trim().slice(0, 30);
    const address = String(input.customer?.address ?? '').trim().slice(0, 300);
    if (!name) throw new OrderError(400, 'Please enter your name.', { needs: 'name' });
    if (phone.replace(/\D/g, '').length < 6) throw new OrderError(400, 'Please enter a phone number we can call.', { needs: 'phone' });
    if (fulfillment === 'delivery' && !address) {
      throw new OrderError(400, 'Where should we deliver?', { needs: 'address' });
    }
    online = { fulfillment, customer: { name, phone, ...(fulfillment === 'delivery' ? { address } : {}) } };
  }

  const idem = input.idempotencyKey ? String(input.idempotencyKey).slice(0, 100) : undefined;
  if (idem) {
    const existing = await ordersCol().findOne({ tenantId: input.tenantOid, idempotencyKey: idem });
    if (existing) return { order: existing, created: false };
  }

  const tenant = await client
    .db('authDB')
    .collection('tenants')
    .findOne({ _id: input.tenantOid }, { projection: { timezone: 1, kitchen: 1 } });
  const kitchen = kitchenSettings(tenant as { kitchen?: Partial<KitchenSettings> } | null);
  const lines = await priceLines({
    tenantOid: input.tenantOid,
    locationId: input.locationId,
    lines: input.lines,
    defaultPrepMinutes: kitchen.defaultPrepMinutes,
    channel,
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

  const day = businessDay((tenant?.timezone as string) || DEFAULT_TIMEZONE);
  const now = new Date();
  const ahead = await kitchenQueue(input.tenantOid, input.locationId, now, kitchen.defaultPrepMinutes);
  const eta = orderEta(lines, ahead, kitchen, now);
  const doc: OrderDoc = {
    tenantId: input.tenantOid,
    locationId: input.locationId,
    branch: input.branch ?? null,
    channel,
    orderNumber: await nextOrderNumber(input.tenantOid, day),
    businessDay: day,
    status: 'placed',
    statusHistory: [{ status: 'placed', at: now, by: input.source }],
    ...(dineIn ? { dineIn } : {}),
    ...(online ? { online } : {}),
    items: lines,
    subtotal,
    total: subtotal,
    currency: 'BDT',
    payment: { method: online?.fulfillment === 'delivery' ? 'cod' : 'counter', status: 'unpaid' },
    ...(input.notes && String(input.notes).trim() ? { notes: String(input.notes).trim().slice(0, 500) } : {}),
    source: input.source,
    publicToken: randomBytes(24).toString('base64url'),
    ...(idem ? { idempotencyKey: idem } : {}),
    ...(input.sessionId ? { sessionId: String(input.sessionId).slice(0, 100) } : {}),
    eta,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const res = await ordersCol().insertOne(doc);
    doc._id = res.insertedId;
  } catch (e) {
    // two identical requests raced: the unique index kept one — return it
    if (idem && (e as { code?: number }).code === 11000) {
      const existing = await ordersCol().findOne({ tenantId: input.tenantOid, idempotencyKey: idem });
      if (existing) return { order: existing, created: false };
    }
    throw e;
  }

  publishTenant(input.tenantOid.toHexString(), { type: 'order.created', order: toAdminOrder(doc) });
  return { order: doc, created: true };
}

/* ------------------------------------------------------------------ wait time */

const OPEN_STATUSES: OrderStatus[] = ['placed', 'accepted', 'preparing'];

/** Orders still waiting for / on the stove at this restaurant (branch), oldest first. */
export async function kitchenQueue(
  tenantOid: ObjectId,
  locationId: ObjectId | null,
  now: Date = new Date(),
  defaultPrepMinutes: number = DEFAULT_PREP_MINUTES
): Promise<QueuedOrder[]> {
  const q: Record<string, unknown> = {
    tenantId: tenantOid,
    status: { $in: OPEN_STATUSES },
    createdAt: { $gte: new Date(now.getTime() - STALE_ORDER_MS) },
  };
  if (locationId) q.locationId = locationId;
  const docs = await ordersCol()
    .find(q, { projection: { status: 1, eta: 1, items: 1, createdAt: 1 } })
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray();
  return docs.map((o) => ({
    status: o.status,
    prepMinutes:
      o.eta?.prepMinutes ??
      orderPrepMinutes((o.items ?? []).map((l) => ({ prepMinutes: l.prepMinutes ?? defaultPrepMinutes, qty: l.qty }))),
    readyAt: o.eta?.readyAt ?? null,
    createdAt: o.createdAt ?? null,
  }));
}

/**
 * What an order just accepted waits behind: only orders the kitchen has already taken on (accepted / cooking).
 * Orders still waiting to be accepted haven't reached the kitchen — they don't hold up the one accepted now,
 * whenever they were placed.
 */
export function inTheKitchen(ahead: QueuedOrder[]): QueuedOrder[] {
  return ahead.filter((q) => q.status === 'accepted' || q.status === 'preparing');
}

export function orderEta(lines: OrderLine[], ahead: QueuedOrder[], kitchen: KitchenSettings, now: Date): OrderEta {
  const prep = orderPrepMinutes(lines.map((l) => ({ prepMinutes: l.prepMinutes ?? kitchen.defaultPrepMinutes, qty: l.qty })));
  const queue = queueMinutes(ahead, kitchen.parallelOrders, now);
  const readyAt = new Date(now.getTime() + (prep + queue) * 60_000);
  return { prepMinutes: prep, queueMinutes: queue, promisedReadyAt: readyAt, readyAt };
}

/**
 * New ready time after a status change. The clock only starts once the restaurant takes the order —
 * a "placed" order has an estimate (how long it'll take) but no ready time the guest counts down to.
 *   accepted  → now + wait for a free station (re-measured now) + prep (+ any delay staff added)
 *   preparing → cooking starts now: now + prep (+ delay)
 *   ready     → it's ready: now
 * Leaving "placed" is also when the guest is promised a time (promisedReadyAt).
 * Other moves keep the current estimate.
 */
export function retime(
  eta: OrderEta | undefined,
  to: OrderStatus,
  now: Date,
  opts: { from?: OrderStatus; queueMinutes?: number } = {}
): OrderEta | undefined {
  if (!eta) return eta;
  const delay = Math.max(0, eta.adjustedMinutes ?? 0);
  if (to === 'accepted') {
    const queue = opts.queueMinutes ?? eta.queueMinutes;
    const readyAt = new Date(now.getTime() + (queue + eta.prepMinutes + delay) * 60_000);
    return { ...eta, queueMinutes: queue, readyAt, promisedReadyAt: readyAt };
  }
  if (to === 'preparing') {
    const readyAt = new Date(now.getTime() + (eta.prepMinutes + delay) * 60_000);
    return { ...eta, readyAt, ...(opts.from === 'placed' ? { promisedReadyAt: readyAt } : {}) };
  }
  if (to === 'ready') return { ...eta, readyAt: now };
  return eta;
}

/** New ready time when staff add (or take off) minutes; never earlier than a minute from now. */
export function adjustEta(eta: OrderEta, addMinutes: number, now: Date): OrderEta {
  const from = Math.max(new Date(eta.readyAt).getTime(), now.getTime());
  const readyAt = new Date(Math.max(now.getTime() + 60_000, from + addMinutes * 60_000));
  return { ...eta, readyAt, adjustedMinutes: (eta.adjustedMinutes ?? 0) + addMinutes };
}

/** Staff: "+5 min" / "−5 min" on an order still in the kitchen. */
export async function adjustEtaCore(opts: {
  tenantOid: ObjectId;
  orderId: string;
  addMinutes: number;
  locationId?: ObjectId | null;
}): Promise<OrderDoc> {
  if (!ObjectId.isValid(opts.orderId)) throw new OrderError(400, 'Invalid order id');
  const filter: Record<string, unknown> = { _id: new ObjectId(opts.orderId), tenantId: opts.tenantOid };
  if (opts.locationId) filter.locationId = opts.locationId;
  const current = await ordersCol().findOne(filter);
  if (!current) throw new OrderError(404, 'Order not found');
  if (!OPEN_STATUSES.includes(current.status)) {
    throw new OrderError(409, 'Only orders still in the kitchen have a ready time.');
  }

  const now = new Date();
  // orders placed before wait times existed get one on first adjustment
  const base = current.eta ?? orderEta(current.items, [], kitchenSettings(null), current.createdAt ?? now);
  const eta = adjustEta(base, opts.addMinutes, now);

  const updated = await ordersCol().findOneAndUpdate(
    { ...filter, status: current.status },
    { $set: { eta, updatedAt: now } },
    { returnDocument: 'after' }
  );
  const doc = ((updated as unknown as { value?: OrderDoc })?.value ?? (updated as unknown as OrderDoc | null)) || null;
  if (!doc) throw new OrderError(409, 'This order was just updated by someone else — refresh and try again.');

  publishTenant(opts.tenantOid.toHexString(), { type: 'order.updated', order: toAdminOrder(doc) });
  publishOrder(doc.publicToken, { type: 'order.updated', order: toPublicOrder(doc) });
  return doc;
}

/** Guest, before ordering: "how long would this take right now?" (cart, tray or a single dish). */
export async function estimateForGuest(opts: {
  tenantOid: ObjectId;
  locationId: ObjectId | null;
  items: Array<{ itemId: string; qty: number; variation?: string | null }>;
}) {
  const now = new Date();
  const tenant = await client
    .db('authDB')
    .collection('tenants')
    .findOne({ _id: opts.tenantOid }, { projection: { kitchen: 1 } });
  const kitchen = kitchenSettings(tenant as { kitchen?: Partial<KitchenSettings> } | null);
  const ids = opts.items.filter((l) => ObjectId.isValid(l.itemId)).map((l) => new ObjectId(l.itemId));
  const docs = ids.length
    ? await itemsCol()
        .find({ _id: { $in: ids }, tenantId: opts.tenantOid }, { projection: { prepMinutes: 1, variations: 1 } })
        .toArray()
    : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const lines = opts.items
    .filter((l) => byId.has(l.itemId))
    .map((l) => ({ item: byId.get(l.itemId) as TimedItem, variation: l.variation, qty: l.qty }));
  const ahead = await kitchenQueue(opts.tenantOid, opts.locationId, now, kitchen.defaultPrepMinutes);
  const e = estimate({ lines, ahead, settings: kitchen, now });
  return {
    prepMinutes: e.prepMinutes,
    queueMinutes: e.queueMinutes,
    totalMinutes: e.totalMinutes,
    readyAt: e.readyAt.toISOString(),
    estimated: e.estimated,
    busy: busyLevel(e.queueMinutes),
    ordersInKitchen: ahead.filter((o) => !isForgotten(o, now)).length,
    defaultPrepMinutes: kitchen.defaultPrepMinutes,
    serverNow: now.toISOString(),
  };
}

/** The ETA as guests and staff see it. `serverNow` lets the browser correct for its own clock. */
function etaView(o: OrderDoc, now: Date = new Date()) {
  if (!o.eta) return undefined;
  // not taken yet: no clock — minutesLeft is how long it'll take once the restaurant accepts
  const waiting = o.status === 'placed';
  const open = OPEN_STATUSES.includes(o.status) && !waiting;
  const readyAt = new Date(o.eta.readyAt);
  const estimateMinutes = o.eta.queueMinutes + o.eta.prepMinutes + Math.max(0, o.eta.adjustedMinutes ?? 0);
  return {
    /** true until the restaurant accepts: show estimateMinutes, don't count down */
    startsOnAccept: waiting,
    estimateMinutes,
    prepMinutes: o.eta.prepMinutes,
    queueMinutes: o.eta.queueMinutes,
    promisedReadyAt: new Date(o.eta.promisedReadyAt).toISOString(),
    readyAt: readyAt.toISOString(),
    minutesLeft: waiting ? estimateMinutes : open ? minutesLeft(readyAt, now) : 0,
    /** Still in the kitchen past the estimate */
    late: open && readyAt.getTime() < now.getTime(),
    adjustedMinutes: o.eta.adjustedMinutes ?? 0,
    serverNow: now.toISOString(),
  };
}

/* ------------------------------------------------------------------ status flow */

const FLOW: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'completed'];

/** Forward moves (skipping steps is fine for busy kitchens) and cancel from any open state. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  if (from === 'completed' || from === 'cancelled') return false;
  if (to === 'cancelled') return true;
  return FLOW.indexOf(to) > FLOW.indexOf(from);
}

export async function updateStatusCore(opts: {
  tenantOid: ObjectId;
  orderId: string;
  to: OrderStatus;
  by?: string;
  locationId?: ObjectId | null;
}): Promise<OrderDoc> {
  if (!ObjectId.isValid(opts.orderId)) throw new OrderError(400, 'Invalid order id');
  const filter: Record<string, unknown> = { _id: new ObjectId(opts.orderId), tenantId: opts.tenantOid };
  if (opts.locationId) filter.locationId = opts.locationId;
  const current = await ordersCol().findOne(filter);
  if (!current) throw new OrderError(404, 'Order not found');
  if (!canTransition(current.status, opts.to)) {
    throw new OrderError(409, `Can't move an order from ${current.status} to ${opts.to}`);
  }
  const now = new Date();
  let queue: number | undefined;
  if (opts.to === 'accepted' && current.eta) {
    // the wait for a free station, as it is now — orders ahead may have finished since this one came in
    const tenant = await client
      .db('authDB')
      .collection('tenants')
      .findOne({ _id: opts.tenantOid }, { projection: { kitchen: 1 } });
    const kitchen = kitchenSettings(tenant as { kitchen?: Partial<KitchenSettings> } | null);
    const all = await kitchenQueue(opts.tenantOid, current.locationId ?? null, now, kitchen.defaultPrepMinutes);
    queue = queueMinutes(inTheKitchen(all), kitchen.parallelOrders, now);
  }
  const eta = retime(current.eta, opts.to, now, { from: current.status, queueMinutes: queue });
  const updated = await ordersCol().findOneAndUpdate(
    { ...filter, status: current.status }, // optimistic: nobody changed it meanwhile
    {
      $set: { status: opts.to, updatedAt: now, ...(eta ? { eta } : {}) },
      $push: { statusHistory: { status: opts.to, at: now, ...(opts.by ? { by: opts.by } : {}) } },
    },
    { returnDocument: 'after' }
  );
  const doc = ((updated as unknown as { value?: OrderDoc })?.value ?? (updated as unknown as OrderDoc | null)) || null;
  if (!doc) throw new OrderError(409, 'This order was just updated by someone else — refresh and try again.');

  publishTenant(opts.tenantOid.toHexString(), { type: 'order.updated', order: toAdminOrder(doc) });
  publishOrder(doc.publicToken, { type: 'order.updated', order: toPublicOrder(doc) });
  return doc;
}

/* ------------------------------------------------------------------ views */

function lineView(l: OrderLine) {
  return {
    itemId: String(l.itemId),
    name: l.name,
    qty: l.qty,
    ...(l.variation ? { variation: l.variation } : {}),
    modifiers: (l.modifiers || []).map((m) => ({ groupName: m.groupName, name: m.name, price: m.price })),
    unitPrice: l.unitPrice,
    lineTotal: l.lineTotal,
    ...(l.notes ? { notes: l.notes } : {}),
    ...(typeof l.prepMinutes === 'number' ? { prepMinutes: l.prepMinutes } : {}),
  };
}

/** What the guest may see (via their private token) */
export function toPublicOrder(o: OrderDoc) {
  return {
    token: o.publicToken,
    orderNumber: o.orderNumber,
    status: o.status,
    statusHistory: o.statusHistory.map((h) => ({ status: h.status, at: h.at })),
    channel: o.channel ?? 'dine-in',
    table: o.dineIn?.tableNumber ?? null,
    ...(o.online ? { fulfillment: o.online.fulfillment, customer: o.online.customer } : {}),
    items: o.items.map(lineView),
    subtotal: o.subtotal,
    total: o.total,
    currency: o.currency,
    payment: o.payment,
    ...(o.notes ? { notes: o.notes } : {}),
    ...(o.eta ? { eta: etaView(o) } : {}),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/** What restaurant staff see */
export function toAdminOrder(o: OrderDoc) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { token, ...pub } = toPublicOrder(o); // the guest's tracking token stays private
  return {
    ...pub,
    id: String(o._id),
    locationId: o.locationId ? String(o.locationId) : null,
    branch: o.branch ?? null,
    source: o.source,
    businessDay: o.businessDay,
  };
}
