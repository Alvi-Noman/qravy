// services/auth-service/src/services/customers.ts
// A restaurant's customers — the guests who ordered online: delivery (name, phone, address) and pickup (name, phone).
// Dine-in guests give no contact details and aren't saved. One customer per phone number per restaurant ("01712-345678",
// "+8801712345678" and "8801712345678" are the same person), updated with every online order: the latest name, the
// delivery addresses used (newest first), when they first / last ordered, at which branches. Their order count and
// spend are counted from the orders themselves when the list is read (a cancelled order doesn't count).
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import type { OrderDoc } from '../models/Order.js';

export type CustomerDoc = {
  _id?: ObjectId;
  tenantId: ObjectId;
  /** the phone number, normalised ("01712345678") — one customer per number */
  key: string;
  name: string;
  /** as they last typed it */
  phone: string;
  /** every way they've typed it (to find their orders) */
  phones: string[];
  /** delivery addresses, newest first (pickup gives none) */
  addresses: string[];
  lastFulfillment: 'delivery' | 'pickup';
  locationIds: ObjectId[];
  firstOrderAt: Date;
  lastOrderAt: Date;
  updatedAt: Date;
};

export const customersCol = () => client.db('authDB').collection<CustomerDoc>('customers');
const MAX_ADDRESSES = 5;

/** "+880 1712-345678" / "8801712345678" / "01712345678" → "01712345678" (Bangladesh); other numbers: just the digits. */
export function phoneKey(phone: string): string {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('880') && d.length === 13) d = '0' + d.slice(3);
  else if (d.startsWith('1') && d.length === 10) d = '0' + d;
  return d;
}

/** An online order → its customer saved / updated. Dine-in orders have no customer. */
export async function saveCustomerFromOrder(o: OrderDoc): Promise<void> {
  const c = o.online?.customer;
  if (!c?.phone) return;
  const key = phoneKey(c.phone);
  if (key.length < 6) return;
  const at = o.createdAt ?? new Date();
  const address = o.online?.fulfillment === 'delivery' ? String(c.address ?? '').trim() : '';
  const existing = await customersCol().findOne({ tenantId: o.tenantId, key }, { projection: { addresses: 1, lastOrderAt: 1 } });
  // an older order (the first fill-in) never overwrites a newer one's name / address order
  const newest = !existing || at >= existing.lastOrderAt;
  const addresses = address
    ? newest
      ? [address, ...(existing?.addresses ?? []).filter((a) => a.toLowerCase() !== address.toLowerCase())]
      : [...(existing?.addresses ?? []), ...((existing?.addresses ?? []).some((a) => a.toLowerCase() === address.toLowerCase()) ? [] : [address])]
    : (existing?.addresses ?? []);
  await customersCol().updateOne(
    { tenantId: o.tenantId, key },
    {
      $set: {
        ...(newest ? { name: c.name, phone: c.phone, lastFulfillment: o.online!.fulfillment, lastOrderAt: at } : {}),
        addresses: addresses.slice(0, MAX_ADDRESSES),
        updatedAt: new Date(),
      },
      $addToSet: { phones: c.phone, ...(o.locationId ? { locationIds: o.locationId } : {}) },
      $min: { firstOrderAt: at },
      $setOnInsert: { tenantId: o.tenantId, key, ...(newest ? {} : { name: c.name, phone: c.phone, lastFulfillment: o.online!.fulfillment, lastOrderAt: at }) },
    },
    { upsert: true }
  );
}

/** Once: the customers from online orders placed before customers were saved. */
export async function backfillCustomers(): Promise<number> {
  if (await customersCol().estimatedDocumentCount()) return 0;
  const cursor = client
    .db('authDB')
    .collection<OrderDoc>('orders')
    .find({ channel: 'online', 'online.customer.phone': { $exists: true } })
    .sort({ createdAt: 1 });
  let n = 0;
  for await (const o of cursor) {
    await saveCustomerFromOrder(o);
    n++;
  }
  return n;
}

export type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  addresses: string[];
  lastFulfillment: 'delivery' | 'pickup';
  orders: number;
  deliveries: number;
  pickups: number;
  spent: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
};

/** The customer list (newest order first), with each one's orders and spend; `q` searches name / phone / address. */
export async function listCustomers(opts: {
  tenantOid: ObjectId;
  locationId?: ObjectId | null;
  q?: string;
  limit?: number;
  skip?: number;
}): Promise<{ items: CustomerRow[]; total: number }> {
  const filter: Record<string, unknown> = { tenantId: opts.tenantOid };
  if (opts.locationId) filter.locationIds = opts.locationId;
  const q = String(opts.q ?? '').trim();
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const digits = phoneKey(q);
    filter.$or = [{ name: rx }, { phone: rx }, { addresses: rx }, ...(digits.length >= 3 ? [{ key: { $regex: digits.replace(/^0/, '') } }] : [])];
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const [docs, total] = await Promise.all([
    customersCol().find(filter).sort({ lastOrderAt: -1 }).skip(Math.max(0, opts.skip ?? 0)).limit(limit).toArray(),
    customersCol().countDocuments(filter),
  ]);
  // their orders, counted now (cancelled ones don't count; a branch login counts its branch's)
  const phones = docs.flatMap((d) => d.phones ?? [d.phone]);
  const stats = phones.length
    ? await client
        .db('authDB')
        .collection<OrderDoc>('orders')
        .aggregate<{ _id: string; orders: number; spent: number; deliveries: number; pickups: number }>([
          {
            $match: {
              tenantId: opts.tenantOid,
              channel: 'online',
              'online.customer.phone': { $in: phones },
              status: { $ne: 'cancelled' },
              ...(opts.locationId ? { locationId: opts.locationId } : {}),
            },
          },
          {
            $group: {
              _id: '$online.customer.phone',
              orders: { $sum: 1 },
              spent: { $sum: '$total' },
              deliveries: { $sum: { $cond: [{ $eq: ['$online.fulfillment', 'delivery'] }, 1, 0] } },
              pickups: { $sum: { $cond: [{ $eq: ['$online.fulfillment', 'pickup'] }, 1, 0] } },
            },
          },
        ])
        .toArray()
    : [];
  const byPhone = new Map(stats.map((s) => [s._id, s]));
  const items = docs.map((d) => {
    const mine = (d.phones ?? [d.phone]).map((p) => byPhone.get(p)).filter(Boolean) as typeof stats;
    const sum = (k: 'orders' | 'spent' | 'deliveries' | 'pickups') => mine.reduce((s, x) => s + (x[k] || 0), 0);
    return {
      id: String(d._id),
      name: d.name,
      phone: d.phone,
      addresses: d.addresses ?? [],
      lastFulfillment: d.lastFulfillment,
      orders: sum('orders'),
      deliveries: sum('deliveries'),
      pickups: sum('pickups'),
      spent: Math.round(sum('spent') * 100) / 100,
      firstOrderAt: d.firstOrderAt,
      lastOrderAt: d.lastOrderAt,
    };
  });
  return { items, total };
}
