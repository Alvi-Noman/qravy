// services/auth-service/src/services/cortex/analytics.ts
// What Cortex shows: every restaurant on the platform, how guests use it and how that turns into orders.
// Sources:
//   authDB.tenants / locations / orders / serviceRequests / memberships — the restaurants and their orders
//   authDB.guestEvents   — scans, visits, AI waiter use, suggestions, checkout, orders, time on page (routes/eventsRoutes)
//   <waiter db>.transcripts, upsell_offers — what the AI waiter heard / understood / said, and its offers
// A "session" is one guest visit (the storefront's visit id: a tab, ended by 30 minutes of quiet).
import { ObjectId, type Document } from 'mongodb';
import { client } from '../../db.js';

const auth = () => client.db('authDB');
const waiterDb = () => client.db(process.env.WAITER_DB_NAME || 'qravy');
const events = () => auth().collection('guestEvents');
const orders = () => auth().collection('orders');
const tenants = () => auth().collection('tenants');
const locations = () => auth().collection('locations');
const transcripts = () => waiterDb().collection('transcripts');

export type Filters = {
  days: number;
  /** an exact window instead of "the last N days" (a restaurant's own Today, Yesterday, a custom range) */
  from?: Date | null;
  to?: Date | null;
  tenantId?: ObjectId | null;
  locationId?: ObjectId | null;
  channel?: 'dine-in' | 'online' | null;
};

export const sinceOf = (days: number) => new Date(Date.now() - days * 86400_000);
/** The window the filters cover, as a Mongo range: from..to (exclusive), or the last N days. */
const windowOf = (f: Filters): Document => (f.from ? { $gte: f.from, ...(f.to ? { $lt: f.to } : {}) } : { $gte: sinceOf(f.days) });
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const rate = (a: number, b: number) => (b ? round(a / b, 4) : null);
const ENGAGED = ['waiter_start', 'ai_turn'];

function eventMatch(f: Filters): Document {
  return {
    at: windowOf(f),
    ...(f.tenantId ? { tenantId: f.tenantId } : {}),
    ...(f.locationId ? { locationId: f.locationId } : {}),
    ...(f.channel ? { channel: f.channel } : {}),
  };
}

function orderMatch(f: Filters): Document {
  return {
    createdAt: windowOf(f),
    ...(f.tenantId ? { tenantId: f.tenantId } : {}),
    ...(f.locationId ? { locationId: f.locationId } : {}),
    ...(f.channel ? { channel: f.channel } : {}),
  };
}

export type SessionRow = {
  vid: string;
  tenantId: string;
  sub: string;
  locationId: string | null;
  branch: string | null;
  channel: string;
  table: string | null;
  did: string;
  device: string | null;
  first: Date;
  last: Date;
  minutes: number;
  views: number;
  scans: number;
  aiTurns: number;
  suggestionsOpened: number;
  suggestionsAdded: number;
  itemsAdded: number;
  calls: number;
  scanned: boolean;
  engaged: boolean;
  checkout: boolean;
  ordered: boolean;
  orders: Array<{ token?: string; orderNumber?: number; total?: number }>;
};

/** One row per guest visit matching the filters, newest first. */
export async function sessionRows(f: Filters, limit = 50_000, extra: Document = {}): Promise<SessionRow[]> {
  const cnt = (t: string) => ({ $sum: { $cond: [{ $eq: ['$type', t] }, 1, 0] } });
  const rows = await events()
    .aggregate(
      [
        { $match: { ...eventMatch(f), ...extra } },
        { $sort: { at: 1 } },
        {
          $group: {
            _id: '$vid',
            tenantId: { $first: '$tenantId' },
            sub: { $first: '$sub' },
            locationId: { $first: '$locationId' },
            branch: { $first: '$branch' },
            channel: { $first: '$channel' },
            table: { $max: '$table' },
            did: { $first: '$did' },
            device: { $first: '$device' },
            first: { $min: '$at' },
            last: { $max: '$at' },
            types: { $addToSet: '$type' },
            views: cnt('visit'),
            scans: cnt('scan'),
            aiTurns: cnt('ai_turn'),
            suggestionsOpened: cnt('suggestions_opened'),
            suggestionsAdded: cnt('suggestion_added'),
            itemsAdded: cnt('item_added'),
            calls: cnt('call_waiter'),
            orders: { $push: { $cond: [{ $eq: ['$type', 'order_placed'] }, '$data', '$$REMOVE'] } },
          },
        },
        { $sort: { first: -1 } },
        { $limit: limit },
      ],
      { allowDiskUse: true }
    )
    .toArray();
  return rows.map((r) => {
    const types = new Set<string>(r.types as string[]);
    return {
      vid: String(r._id),
      tenantId: String(r.tenantId),
      sub: r.sub,
      locationId: r.locationId ? String(r.locationId) : null,
      branch: r.branch ?? null,
      channel: r.channel,
      table: r.table ?? null,
      did: r.did,
      device: r.device ?? null,
      first: r.first,
      last: r.last,
      minutes: round((new Date(r.last).getTime() - new Date(r.first).getTime()) / 60000, 1),
      views: r.views,
      scans: r.scans,
      aiTurns: r.aiTurns,
      suggestionsOpened: r.suggestionsOpened,
      suggestionsAdded: r.suggestionsAdded,
      itemsAdded: r.itemsAdded,
      calls: r.calls,
      scanned: r.scans > 0,
      engaged: ENGAGED.some((t) => types.has(t)),
      checkout: types.has('checkout_started'),
      ordered: types.has('order_placed'),
      orders: (r.orders as SessionRow['orders']) ?? [],
    };
  });
}

/** The guest funnel and its rates for a set of visits. */
export function funnel(rows: SessionRow[]) {
  const n = rows.length;
  const c = (p: (r: SessionRow) => boolean) => rows.filter(p).length;
  const scanned = c((r) => r.scanned);
  const engaged = c((r) => r.engaged);
  const checkout = c((r) => r.checkout);
  const ordered = c((r) => r.ordered);
  const minutes = rows.map((r) => r.minutes).sort((a, b) => a - b);
  const median = minutes.length ? minutes[Math.floor(minutes.length / 2)] : null;
  return {
    sessions: n,
    pageViews: rows.reduce((s, r) => s + r.views, 0),
    scans: rows.reduce((s, r) => s + r.scans, 0),
    scannedSessions: scanned,
    engagedSessions: engaged,
    aiTurns: rows.reduce((s, r) => s + r.aiTurns, 0),
    suggestionsOpenedSessions: c((r) => r.suggestionsOpened > 0),
    suggestionsAdded: rows.reduce((s, r) => s + r.suggestionsAdded, 0),
    itemsAdded: rows.reduce((s, r) => s + r.itemsAdded, 0),
    cartSessions: c((r) => r.itemsAdded > 0 || r.checkout || r.ordered),
    checkoutSessions: checkout,
    orderedSessions: ordered,
    waiterCalls: rows.reduce((s, r) => s + r.calls, 0),
    avgMinutes: n ? round(minutes.reduce((s, m) => s + m, 0) / n, 1) : null,
    medianMinutes: median,
    rates: {
      visitToOrder: rate(ordered, n),
      engagement: rate(engaged, n),
      engagedToOrder: rate(c((r) => r.engaged && r.ordered), engaged),
      checkoutToOrder: rate(c((r) => r.checkout && r.ordered), checkout),
      scanToOrder: rate(c((r) => r.scanned && r.ordered), scanned),
      suggestionTake: rate(c((r) => r.suggestionsAdded > 0), c((r) => r.suggestionsOpened > 0 || r.aiTurns > 0)),
      checkoutAbandon: checkout ? round(1 - c((r) => r.checkout && r.ordered) / checkout, 4) : null,
      aiEngagedShareOfOrders: rate(c((r) => r.engaged && r.ordered), ordered),
    },
  };
}

/** Orders: count, revenue (not cancelled), by channel / source / status, average order value. */
export async function orderStats(f: Filters) {
  const docs = await orders()
    .find(orderMatch(f), { projection: { total: 1, channel: 1, source: 1, status: 1, createdAt: 1 } })
    .toArray();
  const live = docs.filter((o) => o.status !== 'cancelled');
  const revenue = live.reduce((s, o) => s + Number(o.total || 0), 0);
  const by = (k: string, list: Document[]) =>
    list.reduce<Record<string, number>>((m, o) => ((m[String(o[k] ?? 'unknown')] = (m[String(o[k] ?? 'unknown')] || 0) + 1), m), {});
  return {
    orders: docs.length,
    completed: docs.filter((o) => o.status === 'completed').length,
    cancelled: docs.length - live.length,
    revenue: round(revenue, 2),
    avgOrderValue: live.length ? round(revenue / live.length, 2) : null,
    byChannel: by('channel', live),
    bySource: by('source', live),
    byStatus: by('status', docs),
  };
}

/** What the AI waiter did: turns, conversations, turns it couldn't hear, model fallbacks. */
export async function aiStats(f: Filters, subs?: string[] | null) {
  const match: Document = { ts: windowOf(f) };
  if (subs) match.tenant = { $in: subs };
  if (f.locationId) match.location = String(f.locationId);
  if (f.channel) match.channel = f.channel;
  const [agg] = await transcripts()
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          turns: { $sum: 1 },
          unheard: { $sum: { $cond: [{ $eq: ['$status', 'unheard'] }, 1, 0] } },
          fallback: { $sum: { $cond: [{ $eq: ['$ai.meta.fallback', true] }, 1, 0] } },
          ordered: { $sum: { $cond: [{ $eq: ['$ai.meta.decision.orderPlaced', true] }, 1, 0] } },
          convos: { $addToSet: { $concat: [{ $ifNull: ['$tenant', ''] }, '|', { $ifNull: ['$session', ''] }] } },
        },
      },
      { $project: { turns: 1, unheard: 1, fallback: 1, ordered: 1, conversations: { $size: '$convos' } } },
    ])
    .toArray();
  const w = windowOf(f);
  const upsMatch: Document = { at: { $gte: (w.$gte as Date).getTime() / 1000, ...(w.$lt ? { $lt: (w.$lt as Date).getTime() / 1000 } : {}) } };
  if (subs) upsMatch.tenant = { $in: subs };
  if (f.locationId) upsMatch.location = String(f.locationId);
  const offers = await waiterDb()
    .collection('upsell_offers')
    .find(upsMatch, { projection: { outcome: 1, revenue: 1 } })
    .toArray();
  const accepted = offers.filter((o) => o.outcome === 'accepted').length;
  const decided = offers.filter((o) => ['accepted', 'declined', 'ignored'].includes(String(o.outcome))).length;
  return {
    turns: agg?.turns ?? 0,
    conversations: agg?.conversations ?? 0,
    unheardRate: rate(agg?.unheard ?? 0, agg?.turns ?? 0),
    fallbackRate: rate(agg?.fallback ?? 0, agg?.turns ?? 0),
    ordersByWaiter: agg?.ordered ?? 0,
    upsell: {
      offers: offers.length,
      accepted,
      takeRate: rate(accepted, decided),
      revenue: round(offers.reduce((s, o) => s + Number(o.revenue || 0), 0), 2),
    },
  };
}

/** Per day (restaurant time doesn't matter at platform scale: UTC days): visits, engaged, checkout, orders, revenue. */
export async function dailySeries(f: Filters, rows: SessionRow[]) {
  const days: Record<string, { day: string; sessions: number; engaged: number; checkout: number; orderedSessions: number; orders: number; revenue: number; scans: number }> = {};
  const key = (d: Date) => new Date(d).toISOString().slice(0, 10);
  const since = sinceOf(f.days);
  for (let t = since.getTime(); t <= Date.now(); t += 86400_000) {
    const k = key(new Date(t));
    days[k] = { day: k, sessions: 0, engaged: 0, checkout: 0, orderedSessions: 0, orders: 0, revenue: 0, scans: 0 };
  }
  for (const r of rows) {
    const d = days[key(r.first)];
    if (!d) continue;
    d.sessions++;
    d.scans += r.scans;
    if (r.engaged) d.engaged++;
    if (r.checkout) d.checkout++;
    if (r.ordered) d.orderedSessions++;
  }
  const os = await orders()
    .find(orderMatch(f), { projection: { createdAt: 1, total: 1, status: 1 } })
    .toArray();
  for (const o of os) {
    const d = days[key(o.createdAt)];
    if (!d) continue;
    d.orders++;
    if (o.status !== 'cancelled') d.revenue = round(d.revenue + Number(o.total || 0), 2);
  }
  return Object.values(days);
}

/** Restaurant names / subdomains / branch names by id, for labelling rows. */
export async function labels() {
  const ts = await tenants().find({}, { projection: { name: 1, subdomain: 1, demo: 1 } }).toArray();
  const ls = await locations().find({}, { projection: { name: 1, tenantId: 1, slug: 1 } }).toArray();
  return {
    tenant: new Map(ts.map((t) => [String(t._id), { name: String(t.name ?? t.subdomain), subdomain: String(t.subdomain), demo: !!t.demo }])),
    branch: new Map(ls.map((l) => [String(l._id), String(l.name)])),
  };
}

/* ------------------------------------------------------------------ the AI waiter's turns, as Cortex reads them */

/** One turn: heard → understood → said (same reading as the restaurant's own Conversations page). */
export function turnView(doc: Document) {
  const ai = (doc.ai ?? {}) as Document;
  const meta = (ai.meta ?? {}) as Document;
  const heard = String(doc.text ?? '');
  const cleaned = String(doc.text_norm ?? '');
  const corrections = ((doc.norm_changes ?? []) as unknown[])
    .filter((c): c is [string, string] => Array.isArray(c) && c.length >= 2 && c[0] !== c[1])
    .map((c) => ({ from: String(c[0]), to: String(c[1]) }));
  const actions = ((meta.cartOps ?? []) as Document[])
    .filter((op) => op && op.op)
    .map((op) => ({ op: op.op, name: op.name, quantity: op.quantity, variant: op.variant }));
  if (meta.clearCart) actions.push({ op: 'clear', name: undefined, quantity: undefined, variant: undefined });
  const guards = ((meta.guards ?? []) as unknown[]).map(String);
  if (meta.fallback) guards.push('model_unavailable');
  return {
    at: doc.ts,
    input: doc.engine === 'typed' ? 'typed' : 'voice',
    engine: doc.engine ?? null,
    heard,
    unheard: doc.status === 'unheard',
    understood: {
      text: cleaned && cleaned !== heard ? cleaned : null,
      corrections,
      language: meta.language ?? null,
      intent: meta.intent ?? null,
      topic: meta.topic ?? null,
      actions,
      mentioned: ((meta.mentionedItems ?? []) as Document[]).map((m) => m?.name).filter(Boolean),
      suggested: ((meta.suggestions ?? []) as Document[]).map((s) => s?.title).filter(Boolean),
      orderPlaced: !!(meta.decision as Document | undefined)?.orderPlaced,
      orderNumber: (meta.order as Document | undefined)?.orderNumber ?? null,
      upsellOffer: (meta.upsellOffer as Document | undefined)?.type ?? null,
    },
    said: String(ai.replyText ?? ''),
    flags: [...new Set(guards)],
    branch: doc.branch ?? null,
    location: doc.location ?? null,
    table: doc.table ?? null,
    channel: doc.channel ?? null,
  };
}

export const transcriptsCol = transcripts;
export const eventsCol = events;
export const ordersCol = orders;
export const tenantsCol = tenants;
export const locationsCol = locations;
export const waiterDbOf = waiterDb;
