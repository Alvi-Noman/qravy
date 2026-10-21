// services/auth-service/src/routes/cortexRoutes.ts
// /api/v1/cortex/* — the company's admin panel (apps/cortex). Sign-in with a Cortex admin (utils/cortexAuth); every
// other route needs its token. Read-only views of every restaurant on the platform.
import express, { type Request, type Response, type NextFunction } from 'express';
import { ObjectId, type Document } from 'mongodb';
import { client } from '../db.js';
import { cortexLogin, requireCortex } from '../utils/cortexAuth.js';
import {
  aiStats,
  dailySeries,
  eventsCol,
  funnel,
  labels,
  locationsCol,
  orderStats,
  ordersCol,
  sessionRows,
  sinceOf,
  tenantsCol,
  transcriptsCol,
  turnView,
  voiceClipsCol,
  waiterDbOf,
  type Filters,
  type SessionRow,
} from '../services/cortex/analytics.js';
import { addMonths, billingDTO, money, newPaymentId, parsePrice, type Billing } from '../services/billing.js';

const router: express.Router = express.Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const oid = (v: unknown) => (typeof v === 'string' && ObjectId.isValid(v) ? new ObjectId(v) : null);

function filtersOf(req: Request): Filters {
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const channel = req.query.channel === 'dine-in' || req.query.channel === 'online' ? req.query.channel : null;
  return { days, tenantId: oid(req.query.tenant), locationId: oid(req.query.location), channel };
}

/* ------------------------------------------------------------------ sign-in */

router.post('/cortex/login', wrap(async (req, res) => cortexLogin(req, res)));
router.use('/cortex', (req, res, next) => (req.path === '/login' ? next() : requireCortex(req, res, next)));
router.get('/cortex/me', (req, res) => res.json({ success: true, admin: req.cortex }));

/* ------------------------------------------------------------------ the platform at a glance */

router.get(
  '/cortex/overview',
  wrap(async (req, res) => {
    const f = filtersOf(req);
    const since = sinceOf(f.days);
    const allTenants = await tenantsCol()
      .find({}, { projection: { name: 1, subdomain: 1, demo: 1, createdAt: 1, onboardingCompleted: 1, subscriptionStatus: 1, trialEndsAt: 1 } })
      .toArray();
    const real = allTenants.filter((t) => !t.demo);
    const rows = await sessionRows(f);
    const [orders, ai, series, branches] = await Promise.all([
      orderStats(f),
      aiStats(f),
      dailySeries(f, rows),
      locationsCol().countDocuments({ disabled: { $ne: true } }),
    ]);
    const activeTenants = new Set(rows.map((r) => r.tenantId));
    const ordersByTenant = await ordersCol()
      .aggregate([
        { $match: { createdAt: { $gte: since }, status: { $ne: 'cancelled' } } },
        { $group: { _id: '$tenantId', orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
        { $sort: { orders: -1 } },
        { $limit: 10 },
      ])
      .toArray();
    for (const o of ordersByTenant) activeTenants.add(String(o._id));
    const names = new Map(allTenants.map((t) => [String(t._id), { name: t.name ?? t.subdomain, subdomain: t.subdomain }]));
    const live = await eventsCol().distinct('vid', { at: { $gte: new Date(Date.now() - 5 * 60_000) } });
    res.json({
      success: true,
      days: f.days,
      restaurants: {
        total: real.length,
        demos: allTenants.length - real.length,
        onboarded: real.filter((t) => t.onboardingCompleted).length,
        paying: real.filter((t) => t.subscriptionStatus === 'active').length,
        onTrial: real.filter((t) => t.subscriptionStatus !== 'active' && t.trialEndsAt && new Date(t.trialEndsAt) > new Date()).length,
        newInPeriod: real.filter((t) => t.createdAt && new Date(t.createdAt) >= since).length,
        activeInPeriod: [...activeTenants].filter((id) => real.some((t) => String(t._id) === id)).length,
        branches,
      },
      liveGuests: live.length,
      funnel: funnel(rows),
      orders,
      ai,
      series,
      topRestaurants: ordersByTenant.map((o) => ({
        tenantId: String(o._id),
        ...(names.get(String(o._id)) ?? { name: 'Deleted restaurant', subdomain: '' }),
        orders: o.orders,
        revenue: Math.round(Number(o.revenue || 0) * 100) / 100,
      })),
    });
  })
);

/* ------------------------------------------------------------------ restaurants */

router.get(
  '/cortex/tenants',
  wrap(async (req, res) => {
    const f = filtersOf(req);
    const since = sinceOf(f.days);
    const ts = await tenantsCol()
      .find({}, { projection: { name: 1, subdomain: 1, demo: 1, createdAt: 1, onboardingCompleted: 1, subscriptionStatus: 1, planInfo: 1, trialEndsAt: 1, billing: 1, ownerId: 1, restaurantInfo: 1 } })
      .sort({ createdAt: -1 })
      .toArray();
    const rows = await sessionRows({ ...f, tenantId: null, locationId: null });
    const byTenant = new Map<string, SessionRow[]>();
    for (const r of rows) (byTenant.get(r.tenantId) ?? byTenant.set(r.tenantId, []).get(r.tenantId)!).push(r);
    const ords = await ordersCol()
      .aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: '$tenantId',
            orders: { $sum: 1 },
            revenue: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$total', 0] } },
            last: { $max: '$createdAt' },
          },
        },
      ])
      .toArray();
    const ordBy = new Map(ords.map((o) => [String(o._id), o]));
    const convs = await transcriptsCol()
      .aggregate([
        { $match: { ts: { $gte: since } } },
        { $group: { _id: '$tenant', turns: { $sum: 1 }, sessions: { $addToSet: '$session' }, last: { $max: '$ts' } } },
        { $project: { turns: 1, conversations: { $size: '$sessions' }, last: 1 } },
      ])
      .toArray();
    const convBy = new Map(convs.map((c) => [String(c._id), c]));
    const branchCounts = await locationsCol()
      .aggregate([{ $match: { disabled: { $ne: true } } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }])
      .toArray();
    const brBy = new Map(branchCounts.map((b) => [String(b._id), b.n as number]));
    const owners = await client
      .db('authDB')
      .collection('users')
      .find({ _id: { $in: ts.map((t) => t.ownerId).filter(Boolean) } }, { projection: { email: 1 } })
      .toArray();
    const ownerBy = new Map(owners.map((u) => [String(u._id), String(u.email)]));
    res.json({
      success: true,
      days: f.days,
      items: ts.map((t) => {
        const id = String(t._id);
        const fun = funnel(byTenant.get(id) ?? []);
        const o = ordBy.get(id);
        const c = convBy.get(String(t.subdomain));
        const lastSeen = [byTenant.get(id)?.[0]?.last, o?.last, c?.last].filter(Boolean).map((d) => new Date(d).getTime());
        return {
          id,
          name: t.name ?? t.subdomain,
          subdomain: t.subdomain,
          demo: !!t.demo,
          owner: t.ownerId ? ownerBy.get(String(t.ownerId)) ?? null : null,
          createdAt: t.createdAt ?? null,
          onboarded: !!t.onboardingCompleted,
          subscription: t.subscriptionStatus ?? 'none',
          plan: t.planInfo?.planId ?? null,
          trialEndsAt: t.trialEndsAt ?? null,
          billing: billingDTO(t),
          channels: { dineIn: t.restaurantInfo?.dineInEnabled !== false, online: t.restaurantInfo?.onlineSalesEnabled !== false },
          branches: brBy.get(id) ?? 0,
          lastActivity: lastSeen.length ? new Date(Math.max(...lastSeen)) : null,
          sessions: fun.sessions,
          scans: fun.scans,
          engagedSessions: fun.engagedSessions,
          checkoutSessions: fun.checkoutSessions,
          orders: o?.orders ?? 0,
          revenue: Math.round(Number(o?.revenue || 0) * 100) / 100,
          conversations: c?.conversations ?? 0,
          aiTurns: c?.turns ?? 0,
          visitToOrder: fun.rates.visitToOrder,
          engagedToOrder: fun.rates.engagedToOrder,
          avgMinutes: fun.avgMinutes,
        };
      }),
    });
  })
);

router.get(
  '/cortex/tenants/:id',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    if (!id) return res.status(404).json({ success: false, message: 'Not found' });
    const t = await tenantsCol().findOne({ _id: id });
    if (!t) return res.status(404).json({ success: false, message: 'Not found' });
    const f = { ...filtersOf(req), tenantId: id };
    const db = client.db('authDB');
    const [rows, orders, ai, locs, owner, members, devices, calls] = await Promise.all([
      sessionRows(f),
      orderStats(f),
      aiStats(f, [String(t.subdomain)]),
      locationsCol().find({ tenantId: id }).sort({ createdAt: 1 }).toArray(),
      t.ownerId ? db.collection('users').findOne({ _id: t.ownerId }, { projection: { email: 1 } }) : null,
      db.collection('memberships').find({ tenantId: id, status: 'active' }, { projection: { role: 1, email: 1, locationId: 1 } }).toArray(),
      db.collection('devices').find({ tenantId: id }, { projection: { label: 1, locationId: 1, lastSeenAt: 1, status: 1 } }).toArray(),
      db.collection('serviceRequests').countDocuments({ tenantId: id, createdAt: { $gte: sinceOf(f.days) } }),
    ]);
    const series = await dailySeries(f, rows);
    // per branch × channel
    const branchOrders = await ordersCol()
      .aggregate([
        { $match: { tenantId: id, createdAt: { $gte: sinceOf(f.days) } } },
        {
          $group: {
            _id: { loc: '$locationId', ch: '$channel' },
            orders: { $sum: 1 },
            revenue: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$total', 0] } },
          },
        },
      ])
      .toArray();
    const branchName = new Map(locs.map((l) => [String(l._id), String(l.name)]));
    const groups = new Map<string, { locationId: string | null; branch: string; channel: string; rows: SessionRow[]; orders: number; revenue: number }>();
    const g = (loc: string | null, ch: string) => {
      const k = `${loc ?? ''}|${ch}`;
      if (!groups.has(k)) groups.set(k, { locationId: loc, branch: loc ? branchName.get(loc) ?? 'Deleted branch' : 'No branch', channel: ch, rows: [], orders: 0, revenue: 0 });
      return groups.get(k)!;
    };
    for (const r of rows) g(r.locationId, r.channel).rows.push(r);
    for (const o of branchOrders) {
      const x = g(o._id.loc ? String(o._id.loc) : null, String(o._id.ch ?? 'dine-in'));
      x.orders += o.orders;
      x.revenue += Number(o.revenue || 0);
    }
    const recentOrders = await ordersCol()
      .find({ tenantId: id }, { projection: { orderNumber: 1, status: 1, total: 1, channel: 1, branch: 1, createdAt: 1, source: 1, 'dineIn.tableNumber': 1, items: 1 } })
      .sort({ createdAt: -1 })
      .limit(25)
      .toArray();
    res.json({
      success: true,
      days: f.days,
      tenant: {
        id: String(t._id),
        name: t.name ?? t.subdomain,
        subdomain: t.subdomain,
        demo: !!t.demo,
        owner: owner?.email ?? null,
        createdAt: t.createdAt ?? null,
        onboarded: !!t.onboardingCompleted,
        subscription: t.subscriptionStatus ?? 'none',
        plan: t.planInfo?.planId ?? null,
        trialEndsAt: t.trialEndsAt ?? null,
        billing: billingDTO(t),
        timezone: t.timezone ?? null,
        waiterLanguage: t.waiterLanguage ?? null,
        channels: { dineIn: t.restaurantInfo?.dineInEnabled !== false, online: t.restaurantInfo?.onlineSalesEnabled !== false },
        tables: Array.isArray(t.tables) ? t.tables.length : 0,
      },
      branches: locs.map((l) => ({
        id: String(l._id),
        name: l.name,
        slug: l.slug ?? null,
        address: l.address ?? '',
        disabled: !!l.disabled,
        tables: Array.isArray(l.tables) ? l.tables.length : 0,
        main: t.mainBranchId ? String(t.mainBranchId) === String(l._id) : false,
      })),
      team: {
        members: members.map((m) => ({ role: m.role, email: m.email ?? null, branch: m.locationId ? branchName.get(String(m.locationId)) ?? null : null })),
        devices: devices.map((d) => ({ label: d.label ?? null, branch: d.locationId ? branchName.get(String(d.locationId)) ?? null : null, lastSeenAt: d.lastSeenAt ?? null, status: d.status })),
      },
      funnel: funnel(rows),
      orders,
      ai,
      waiterCalls: calls,
      series,
      byBranch: [...groups.values()].map((x) => {
        const fun = funnel(x.rows);
        return {
          locationId: x.locationId,
          branch: x.branch,
          channel: x.channel,
          sessions: fun.sessions,
          scans: fun.scans,
          engagedSessions: fun.engagedSessions,
          checkoutSessions: fun.checkoutSessions,
          orderedSessions: fun.orderedSessions,
          orders: x.orders,
          revenue: Math.round(x.revenue * 100) / 100,
          visitToOrder: fun.rates.visitToOrder,
          engagedToOrder: fun.rates.engagedToOrder,
          avgMinutes: fun.avgMinutes,
        };
      }),
      recentOrders: recentOrders.map((o) => ({
        id: String(o._id),
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        channel: o.channel,
        branch: o.branch ?? null,
        table: o.dineIn?.tableNumber ?? null,
        source: o.source ?? null,
        items: Array.isArray(o.items) ? o.items.reduce((s: number, i: Document) => s + Number(i.qty || 0), 0) : 0,
        createdAt: o.createdAt,
      })),
    });
  })
);

/* ------------------------------------------------------------------ billing (kept by hand — services/billing.ts) */

function billingView(t: Document) {
  const b = (t.billing ?? {}) as Billing;
  return {
    ...billingDTO(t),
    payments: [...(b.payments ?? [])].reverse(),
    history: [...(b.history ?? [])].reverse().slice(0, 50),
  };
}

router.get(
  '/cortex/restaurants/:id/billing',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    const t = id ? await tenantsCol().findOne({ _id: id }, { projection: { planInfo: 1, trialEndsAt: 1, billing: 1 } }) : null;
    if (!t) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, billing: billingView(t) });
  })
);

/** Change (or clear) the agreed price; optionally correct "paid until". */
router.put(
  '/cortex/restaurants/:id/billing',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    const t = id ? await tenantsCol().findOne({ _id: id }, { projection: { planInfo: 1, trialEndsAt: 1, billing: 1 } }) : null;
    if (!t) return res.status(404).json({ success: false, message: 'Not found' });
    const by = String(req.cortex?.email || 'Qravy');
    const at = new Date();
    const prev = (t.billing ?? {}) as Billing;
    const next: Billing = { ...prev };
    const what: string[] = [];
    if ('customPrice' in (req.body ?? {})) {
      if (req.body.customPrice === null) {
        if (prev.customPrice) what.push(`custom price removed (was ${money(prev.customPrice)}) — list price applies`);
        next.customPrice = null;
      } else {
        const p = parsePrice(req.body.customPrice);
        if (!p) return res.status(400).json({ success: false, message: 'Enter a price above 0, in ৳ or $' });
        next.customPrice = { ...p, setBy: by, at };
        what.push(`custom price ${prev.customPrice ? `${money(prev.customPrice)} → ` : ''}${money(p)}${p.note ? ` — ${p.note}` : ''}`);
      }
    }
    if ('paidUntil' in (req.body ?? {})) {
      const d = req.body.paidUntil ? new Date(req.body.paidUntil) : null;
      if (d && Number.isNaN(d.getTime())) return res.status(400).json({ success: false, message: 'Not a date' });
      next.paidUntil = d;
      what.push(d ? `paid until set to ${d.toISOString().slice(0, 10)}` : 'paid until cleared');
    }
    if (!what.length) return res.json({ success: true, billing: billingView(t) });
    next.history = [...(prev.history ?? []), ...what.map((w) => ({ at, by, what: w }))].slice(-200);
    await tenantsCol().updateOne({ _id: id! }, { $set: { billing: next, updatedAt: at } });
    res.json({ success: true, billing: billingView({ ...t, billing: next }) });
  })
);

/** A payment came in (bKash, bank, cash…): "paid until" moves on by `months` from today or from the current end, whichever is later. */
router.post(
  '/cortex/restaurants/:id/payments',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    const t = id ? await tenantsCol().findOne({ _id: id }, { projection: { planInfo: 1, trialEndsAt: 1, billing: 1 } }) : null;
    if (!t) return res.status(404).json({ success: false, message: 'Not found' });
    const p = parsePrice(req.body);
    if (!p) return res.status(400).json({ success: false, message: 'Enter the amount paid, in ৳ or $' });
    const months = Math.round(Number(req.body?.months));
    if (!Number.isFinite(months) || months < 1 || months > 36) return res.status(400).json({ success: false, message: 'Months: 1 to 36' });
    const method = String(req.body?.method ?? '').trim().slice(0, 40) || 'other';
    const reference = String(req.body?.reference ?? '').trim().slice(0, 100);
    const by = String(req.cortex?.email || 'Qravy');
    const at = new Date();
    const prev = (t.billing ?? {}) as Billing;
    const from = prev.paidUntil && new Date(prev.paidUntil) > at ? new Date(prev.paidUntil) : at;
    const paidUntil = addMonths(from, months);
    const payment = {
      id: newPaymentId(),
      amount: p.amount,
      currency: p.currency,
      at,
      method,
      ...(reference ? { reference } : {}),
      ...(p.note ? { note: p.note } : {}),
      by,
      months,
      paidUntil,
    };
    const next: Billing = {
      ...prev,
      paidUntil,
      payments: [...(prev.payments ?? []), payment].slice(-500),
      history: [
        ...(prev.history ?? []),
        { at, by, what: `payment ${money(p)} (${method}${reference ? ` ${reference}` : ''}) for ${months} month${months === 1 ? '' : 's'} — paid until ${paidUntil.toISOString().slice(0, 10)}` },
      ].slice(-200),
    };
    await tenantsCol().updateOne({ _id: id! }, { $set: { billing: next, subscriptionStatus: 'active', updatedAt: at } });
    res.json({ success: true, billing: billingView({ ...t, billing: next }) });
  })
);

/* ------------------------------------------------------------------ guest sessions */

function sessionView(r: SessionRow, lb: Awaited<ReturnType<typeof labels>>) {
  const t = lb.tenant.get(r.tenantId);
  return {
    vid: r.vid,
    tenantId: r.tenantId,
    restaurant: t?.name ?? r.sub,
    subdomain: r.sub,
    branch: r.locationId ? lb.branch.get(r.locationId) ?? r.branch : r.branch,
    channel: r.channel,
    table: r.table,
    device: r.device,
    startedAt: r.first,
    lastAt: r.last,
    minutes: r.minutes,
    pageViews: r.views,
    scanned: r.scanned,
    aiTurns: r.aiTurns,
    suggestionsAdded: r.suggestionsAdded,
    itemsAdded: r.itemsAdded,
    checkout: r.checkout,
    ordered: r.ordered,
    orders: r.orders,
    calls: r.calls,
  };
}

router.get(
  '/cortex/sessions',
  wrap(async (req, res) => {
    const f = filtersOf(req);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    let rows = await sessionRows(f);
    const only = String(req.query.only || '');
    if (only === 'ordered') rows = rows.filter((r) => r.ordered);
    if (only === 'engaged') rows = rows.filter((r) => r.engaged);
    if (only === 'abandoned') rows = rows.filter((r) => r.checkout && !r.ordered);
    if (only === 'scanned') rows = rows.filter((r) => r.scanned);
    const lb = await labels();
    res.json({ success: true, days: f.days, total: rows.length, items: rows.slice(0, limit).map((r) => sessionView(r, lb)) });
  })
);

router.get(
  '/cortex/sessions/:vid',
  wrap(async (req, res) => {
    const vid = String(req.params.vid).slice(0, 64);
    const evs = await eventsCol().find({ vid }).sort({ at: 1 }).limit(2000).toArray();
    if (!evs.length) return res.status(404).json({ success: false, message: 'Not found' });
    const first = evs[0];
    const start = new Date(first.at).getTime();
    const end = new Date(evs[evs.length - 1].at).getTime();
    // the AI waiter's turns from this device at this restaurant during the visit
    const turns = await transcriptsCol()
      .find({ tenant: first.sub, session: first.did, ts: { $gte: new Date(start - 120_000), $lte: new Date(end + 600_000) } })
      .sort({ ts: 1 })
      .limit(500)
      .toArray();
    const tokens = evs.filter((e) => e.type === 'order_placed' && e.data?.token).map((e) => String(e.data.token));
    const ords = tokens.length
      ? await ordersCol().find({ publicToken: { $in: tokens } }).toArray()
      : await ordersCol()
          .find({ tenantId: first.tenantId, sessionId: first.did, createdAt: { $gte: new Date(start - 60_000), $lte: new Date(end + 600_000) } })
          .toArray();
    const lb = await labels();
    const [row] = await sessionRows({ days: 365 }, 1, { vid });
    res.json({
      success: true,
      session: row ? sessionView(row, lb) : null,
      events: evs.map((e) => ({ type: e.type, page: e.page ?? null, data: e.data ?? null, at: e.at })),
      turns: turns.map(turnView),
      orders: ords.map((o) => ({
        id: String(o._id),
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        channel: o.channel,
        branch: o.branch ?? null,
        table: o.dineIn?.tableNumber ?? null,
        source: o.source ?? null,
        createdAt: o.createdAt,
        items: (o.items ?? []).map((i: Document) => ({ name: i.name, qty: i.qty, variation: i.variation ?? null, lineTotal: i.lineTotal })),
      })),
    });
  })
);

/* ------------------------------------------------------------------ AI conversations across restaurants */

/** A session ends after this much quiet (the same visit rule as the analytics and the restaurant's own page). */
const VISIT_GAP_MS = 30 * 60_000;

type Visit = {
  _id: { tenant: string; session: string; location?: string | null };
  first: Date;
  last: Date;
  turns: number;
  unheard: number;
  ordered: boolean;
  preview: string | null;
  table: string | null;
  channel: string | null;
  branch: string | null;
  language: string | null;
  matched: boolean;
};

/** A guest's turns (oldest first) → their visits, each up to 30 minutes of quiet. */
function splitVisits(docs: Document[]): Document[][] {
  const out: Document[][] = [];
  for (const d of docs) {
    const cur = out[out.length - 1];
    if (cur && new Date(d.ts).getTime() - new Date(cur[cur.length - 1].ts).getTime() <= VISIT_GAP_MS) cur.push(d);
    else out.push([d]);
  }
  return out;
}

router.get(
  '/cortex/conversations',
  wrap(async (req, res) => {
    const f = filtersOf(req);
    const lb = await labels();
    const match: Document = { ts: { $gte: sinceOf(f.days) } };
    if (f.tenantId) match.tenant = lb.tenant.get(String(f.tenantId))?.subdomain ?? '__none__';
    if (f.locationId) match.location = String(f.locationId);
    if (f.channel) match.channel = f.channel;
    const q = String(req.query.q || '').trim();
    const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    // one session = one visit: a guest's turns at one branch until 30 minutes of quiet (as the analytics count them)
    // — not every talk that phone ever had; a search keeps the sessions with a matching turn
    const docs = await transcriptsCol()
      .find(match, {
        projection: { tenant: 1, session: 1, location: 1, ts: 1, status: 1, text: 1, table: 1, channel: 1, branch: 1,
                      'ai.meta.language': 1, 'ai.meta.decision.orderPlaced': 1, ...(rx ? { 'ai.replyText': 1 } : {}) },
      })
      .sort({ ts: 1 })
      .toArray();
    const open = new Map<string, Visit>();
    const visits: Visit[] = [];
    for (const d of docs) {
      const guest = `${d.tenant}|${d.session}|${d.location ?? ''}`;
      const ts = new Date(d.ts);
      let v = open.get(guest);
      if (!v || ts.getTime() - v.last.getTime() > VISIT_GAP_MS) {
        v = { _id: { tenant: d.tenant, session: d.session, location: d.location }, first: ts, last: ts, turns: 0,
              unheard: 0, ordered: false, preview: null, table: null, channel: null, branch: null, language: null,
              matched: !rx };
        open.set(guest, v);
        visits.push(v);
      }
      v.last = ts;
      v.turns += 1;
      if (d.status === 'unheard') v.unheard += 1;
      else if (!v.preview && d.text) v.preview = String(d.text);
      if (d.ai?.meta?.decision?.orderPlaced === true) v.ordered = true;
      v.table = d.table ?? v.table;
      v.channel = d.channel ?? v.channel;
      v.branch = d.branch ?? v.branch;
      v.language = d.ai?.meta?.language ?? v.language;
      if (rx && (rx.test(String(d.text ?? '')) || rx.test(String(d.ai?.replyText ?? '')))) v.matched = true;
    }
    const items = visits
      .filter((v) => v.matched)
      .sort((a, b) => b.last.getTime() - a.last.getTime())
      .slice(0, Math.max(1, Math.min(500, Number(req.query.limit) || 100)));
    const bySub = new Map([...lb.tenant.entries()].map(([id, t]) => [t.subdomain, { id, name: t.name }]));
    res.json({
      success: true,
      days: f.days,
      items: items.map((c) => ({
        id: `${c._id.tenant}|${c._id.session}|${c._id.location ?? ''}|${c.first.getTime()}`,
        tenantId: bySub.get(c._id.tenant)?.id ?? null,
        restaurant: bySub.get(c._id.tenant)?.name ?? c._id.tenant,
        subdomain: c._id.tenant,
        branch: c._id.location ? lb.branch.get(String(c._id.location)) ?? c.branch : c.branch ?? null,
        table: c.table ?? null,
        channel: c.channel ?? null,
        language: c.language ?? null,
        startedAt: c.first,
        lastAt: c.last,
        minutes: Math.round(((new Date(c.last).getTime() - new Date(c.first).getTime()) / 60000) * 10) / 10,
        turns: c.turns,
        unheard: c.unheard,
        ordered: !!c.ordered,
        preview: String(c.preview ?? '').slice(0, 140),
      })),
    });
  })
);

/**
 * GET /cortex/transcripts/live?after=<cursor>&tenant=&location=&channel=
 * The AI waiter's turns as they happen, every restaurant and branch: what it heard, understood and said. Read-only;
 * the cursor is the last turn's id (ids grow with time — nothing missed, nothing twice). No cursor → the latest 50.
 */
router.get(
  '/cortex/transcripts/live',
  wrap(async (req, res) => {
    const f = filtersOf(req);
    const lb = await labels();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
    const match: Document = {};
    if (f.tenantId) match.tenant = lb.tenant.get(String(f.tenantId))?.subdomain ?? '__none__';
    if (f.locationId) match.location = String(f.locationId);
    if (f.channel) match.channel = f.channel;
    const after = oid(req.query.after);
    let docs: Document[];
    if (after) {
      docs = await transcriptsCol().find({ ...match, _id: { $gt: after } }).sort({ _id: 1 }).limit(limit).toArray();
    } else {
      // first load: the latest turns of the last day (oldest first, like the rest of the feed)
      docs = (
        await transcriptsCol()
          .find({ ...match, ts: { $gte: new Date(Date.now() - 24 * 3600_000) } })
          .sort({ _id: -1 })
          .limit(50)
          .toArray()
      ).reverse();
    }
    const bySub = new Map([...lb.tenant.entries()].map(([id, t]) => [t.subdomain, { id, name: t.name }]));
    res.json({
      success: true,
      cursor: docs.length ? String(docs[docs.length - 1]._id) : after ? String(after) : null,
      items: docs.map((d) => {
        const t = bySub.get(String(d.tenant));
        return {
          id: String(d._id),
          // (the session — the visit — this turn is part of)
          conversationId: `${d.tenant}|${d.session}|${d.location ?? ''}|@${new Date(d.ts).getTime()}`,
          tenantId: t?.id ?? null,
          restaurant: t?.name ?? String(d.tenant ?? '?'),
          subdomain: d.tenant ?? null,
          ...turnView(d),
          // the branch by name (the turn itself keeps the link's slug)
          branch: d.location ? lb.branch.get(String(d.location)) ?? d.branch ?? null : d.branch ?? null,
        };
      }),
    });
  })
);

/* ------------------------------------------------------------------ speech-to-text: which restaurants use ElevenLabs */

// the AI waiter reads the switch every 10 s (ai-waiter-service server.py elevenlabs_tenants) and writes the account's
// credits every 15 min (stt_engines.refresh_status): both in its own db's settings
const settingsCol = () => waiterDbOf().collection<Document>('settings');

/** The restaurants on ElevenLabs Scribe, and the ElevenLabs credits (low / used up → Cortex shows a banner). */
router.get(
  '/cortex/stt',
  wrap(async (_req, res) => {
    const [engine, status] = await Promise.all([
      settingsCol().findOne({ _id: 'stt_engine' as unknown as Document['_id'] }),
      settingsCol().findOne({ _id: 'elevenlabs_status' as unknown as Document['_id'] }),
    ]);
    res.json({
      success: true,
      elevenlabs: Array.isArray(engine?.elevenlabs) ? engine.elevenlabs.map(String) : [],
      status: status
        ? {
            configured: !!status.configured,
            used: status.used ?? null,
            limit: status.limit ?? null,
            left: status.left ?? null,
            low: !!status.low,
            out: !!status.out,
            tier: status.tier ?? null,
            model: status.model ?? null,
            resetsAt: status.resetsAt ?? null,
            checkedAt: status.checkedAt ?? null,
            error: status.statusError ?? null,
          }
        : null,
    });
  })
);

/** Switch restaurants (subdomains) onto / off ElevenLabs Scribe: { elevenlabs: ["burger-house", …] }. */
router.put(
  '/cortex/stt',
  wrap(async (req, res) => {
    const list = req.body?.elevenlabs;
    if (!Array.isArray(list)) return res.status(400).json({ success: false, message: 'elevenlabs: a list of restaurants' });
    const subs = [...new Set(list.map((x: unknown) => String(x).trim().toLowerCase()).filter((x: string) => /^[a-z0-9-]{1,63}$/.test(x)))].slice(0, 500);
    await settingsCol().updateOne(
      { _id: 'stt_engine' as unknown as Document['_id'] },
      { $set: { elevenlabs: subs, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ success: true, elevenlabs: subs });
  })
);

/** What the guest said in one turn, as sound (MP3) — the ▶ next to "Heard". Kept a few days (VOICE_CLIP_DAYS). */
router.get(
  '/cortex/voice-clips/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(404).json({ success: false, message: 'Not found' });
    const doc = await voiceClipsCol().findOne({ _id: new ObjectId(id) });
    const audio = doc?.audio as { buffer?: Uint8Array } | undefined;
    if (!doc || !audio?.buffer) return res.status(404).json({ success: false, message: 'Not found (recordings are kept a few days)' });
    res.setHeader('Content-Type', String(doc.mime || 'audio/mpeg'));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(Buffer.from(audio.buffer));
  })
);

router.get(
  '/cortex/conversations/:id',
  wrap(async (req, res) => {
    const [tenant, session, location, start] = String(req.params.id).split('|');
    if (!tenant || !session) return res.status(404).json({ success: false, message: 'Not found' });
    const q: Document = { tenant, session };
    if (location) q.location = location;
    // "<start ms>": the visit that started then; "@<ms>" (a live turn's link): the visit with that turn in it;
    // nothing (an older link): every turn
    const from = /^\d+$/.test(start ?? '') ? Number(start) : null;
    const around = /^@\d+$/.test(start ?? '') ? Number(start.slice(1)) : null;
    if (from !== null) q.ts = { $gte: new Date(from - 1), $lte: new Date(from + 24 * 3600_000) };
    if (around !== null) q.ts = { $gte: new Date(around - 24 * 3600_000), $lte: new Date(around + 24 * 3600_000) };
    const docs = await transcriptsCol().find(q).sort({ ts: 1 }).limit(2000).toArray();
    let turns: Document[] = docs;
    if (from !== null) turns = splitVisits(docs)[0] ?? [];
    if (around !== null)
      turns = splitVisits(docs).find((v) => new Date(v[0].ts).getTime() <= around + 1 && new Date(v[v.length - 1].ts).getTime() >= around - 1) ?? [];
    res.json({ success: true, turns: turns.slice(0, 1000).map(turnView) });
  })
);

/* ------------------------------------------------------------------ orders across restaurants */

router.get(
  '/cortex/orders',
  wrap(async (req, res) => {
    const f = filtersOf(req);
    const q: Document = {
      createdAt: { $gte: sinceOf(f.days) },
      ...(f.tenantId ? { tenantId: f.tenantId } : {}),
      ...(f.locationId ? { locationId: f.locationId } : {}),
      ...(f.channel ? { channel: f.channel } : {}),
      ...(typeof req.query.status === 'string' && req.query.status ? { status: req.query.status } : {}),
    };
    const lb = await labels();
    const docs = await ordersCol()
      .find(q, { projection: { tenantId: 1, orderNumber: 1, status: 1, total: 1, channel: 1, branch: 1, createdAt: 1, source: 1, 'dineIn.tableNumber': 1, 'online.fulfillment': 1, items: 1 } })
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(500, Number(req.query.limit) || 100)))
      .toArray();
    res.json({
      success: true,
      items: docs.map((o) => ({
        id: String(o._id),
        tenantId: String(o.tenantId),
        restaurant: lb.tenant.get(String(o.tenantId))?.name ?? 'Deleted restaurant',
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        channel: o.channel,
        fulfillment: o.online?.fulfillment ?? null,
        branch: o.branch ?? null,
        table: o.dineIn?.tableNumber ?? null,
        source: o.source ?? null,
        items: Array.isArray(o.items) ? o.items.map((i: Document) => `${i.qty}× ${i.name}`).join(', ') : '',
        createdAt: o.createdAt,
      })),
    });
  })
);

/* ------------------------------------------------------------------ right now */

router.get(
  '/cortex/live',
  wrap(async (_req, res) => {
    const since = new Date(Date.now() - 5 * 60_000);
    const lb = await labels();
    const active = await eventsCol()
      .aggregate([
        { $match: { at: { $gte: since } } },
        { $group: { _id: { t: '$tenantId', v: '$vid' }, channel: { $last: '$channel' }, branch: { $last: '$branch' } } },
        { $group: { _id: '$_id.t', guests: { $sum: 1 }, dineIn: { $sum: { $cond: [{ $eq: ['$channel', 'dine-in'] }, 1, 0] } } } },
        { $sort: { guests: -1 } },
      ])
      .toArray();
    const openOrders = await ordersCol().countDocuments({ status: { $in: ['placed', 'accepted', 'preparing', 'ready'] }, createdAt: { $gte: new Date(Date.now() - 12 * 3600_000) } });
    const openCalls = await client.db('authDB').collection('serviceRequests').countDocuments({ status: 'open', createdAt: { $gte: new Date(Date.now() - 3600_000) } });
    const lastTurns = await transcriptsCol().countDocuments({ ts: { $gte: since } });
    res.json({
      success: true,
      guestsNow: active.reduce((s, a) => s + a.guests, 0),
      openOrders,
      openCalls,
      aiTurnsLast5Min: lastTurns,
      byRestaurant: active.map((a) => ({ tenantId: String(a._id), restaurant: lb.tenant.get(String(a._id))?.name ?? '?', guests: a.guests, dineIn: a.dineIn })),
    });
  })
);

// keep the upsell offers collection reachable for future views (by type / restaurant)
export const upsellOffers = () => waiterDbOf().collection('upsell_offers');

export default router;
