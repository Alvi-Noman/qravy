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
  waiterDbOf,
  type Filters,
  type SessionRow,
} from '../services/cortex/analytics.js';

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
      .find({}, { projection: { name: 1, subdomain: 1, demo: 1, createdAt: 1, onboardingCompleted: 1, subscriptionStatus: 1, planInfo: 1, trialEndsAt: 1, ownerId: 1, restaurantInfo: 1 } })
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
    if (q) {
      const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      match.$or = [{ text: rx }, { 'ai.replyText': rx }];
    }
    const items = await transcriptsCol()
      .aggregate(
        [
          { $match: match },
          { $sort: { ts: 1 } },
          {
            $group: {
              _id: { tenant: '$tenant', session: '$session', location: '$location' },
              first: { $min: '$ts' },
              last: { $max: '$ts' },
              turns: { $sum: 1 },
              unheard: { $sum: { $cond: [{ $eq: ['$status', 'unheard'] }, 1, 0] } },
              ordered: { $max: { $cond: [{ $eq: ['$ai.meta.decision.orderPlaced', true] }, 1, 0] } },
              preview: { $first: '$text' },
              table: { $max: '$table' },
              channel: { $max: '$channel' },
              branch: { $max: '$branch' },
              language: { $last: '$ai.meta.language' },
            },
          },
          { $sort: { last: -1 } },
          { $limit: Math.max(1, Math.min(500, Number(req.query.limit) || 100)) },
        ],
        { allowDiskUse: true }
      )
      .toArray();
    const bySub = new Map([...lb.tenant.entries()].map(([id, t]) => [t.subdomain, { id, name: t.name }]));
    res.json({
      success: true,
      days: f.days,
      items: items.map((c) => ({
        id: `${c._id.tenant}|${c._id.session}|${c._id.location ?? ''}`,
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

router.get(
  '/cortex/conversations/:id',
  wrap(async (req, res) => {
    const [tenant, session, location] = String(req.params.id).split('|');
    if (!tenant || !session) return res.status(404).json({ success: false, message: 'Not found' });
    const q: Document = { tenant, session };
    if (location) q.location = location;
    const docs = await transcriptsCol().find(q).sort({ ts: 1 }).limit(1000).toArray();
    res.json({ success: true, turns: docs.map(turnView) });
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
