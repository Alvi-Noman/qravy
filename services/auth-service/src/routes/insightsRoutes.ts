// services/auth-service/src/routes/insightsRoutes.ts
// /api/v1/insights/* — the restaurant's own performance (dashboard → Insights): guests, the AI waiter, orders, dishes.
// Always this restaurant only. A branch login (branch device / branch staff) always gets its own branch; owners and
// admins see every branch combined, or one (?location=<id>, one of theirs).
import express, { type Request, type Response, type NextFunction } from 'express';
import { ObjectId, type Document } from 'mongodb';
import { client } from '../db.js';
import { authenticateJWT } from '../middleware/auth.js';
import { applyScope } from '../middleware/scope.js';
import { authorize } from '../middleware/authorize.js';
import {
  aiStats,
  dailySeries,
  eventsCol,
  funnel,
  orderStats,
  ordersCol,
  sessionRows,
  sinceOf,
  type Filters,
  type SessionRow,
} from '../services/cortex/analytics.js';
import { datesOf, localHourAndDate, periodOf } from '../utils/period.js';

const router: express.Router = express.Router();
const db = () => client.db('authDB');

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** The restaurant, the branch (forced for a branch login; asked-for and checked otherwise) and the period. */
async function scopeOf(req: Request): Promise<{ f: Filters; tenant: Document } | null> {
  const tenantId = req.user?.tenantId;
  if (!tenantId || !ObjectId.isValid(tenantId)) return null;
  const tenantOid = new ObjectId(tenantId);
  const tenant = await db().collection('tenants').findOne({ _id: tenantOid }, { projection: { subdomain: 1, timezone: 1, name: 1 } });
  if (!tenant) return null;
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const channel = req.query.channel === 'dine-in' || req.query.channel === 'online' ? req.query.channel : null;
  let locationId: ObjectId | null = null;
  if (req.user?.sessionType === 'branch' || (req.user as { viewAs?: string } | undefined)?.viewAs === 'branch') {
    locationId = req.user?.locationId && ObjectId.isValid(req.user.locationId) ? new ObjectId(req.user.locationId) : null;
    if (!locationId) return null; // a branch login without its branch sees nothing, never everything
  } else if (typeof req.query.location === 'string' && ObjectId.isValid(req.query.location)) {
    const loc = await db().collection('locations').findOne({ _id: new ObjectId(req.query.location), tenantId: tenantOid }, { projection: { _id: 1 } });
    if (!loc) return null;
    locationId = loc._id as ObjectId;
  }
  return { f: { days, tenantId: tenantOid, locationId, channel }, tenant };
}

const guard = [authenticateJWT, applyScope, authorize('reports:view')];

/* ------------------------------------------------------------------ performance */

router.get(
  '/insights/overview',
  ...guard,
  wrap(async (req, res) => {
    const s = await scopeOf(req);
    if (!s) return res.status(404).json({ success: false, message: 'Not found' });
    const { f, tenant } = s;
    const since = sinceOf(f.days);
    const tz = String(tenant.timezone || 'Asia/Dhaka');
    const orderMatch: Document = {
      tenantId: f.tenantId,
      createdAt: { $gte: since },
      ...(f.locationId ? { locationId: f.locationId } : {}),
      ...(f.channel ? { channel: f.channel } : {}),
    };
    const [rows, orders, ai, calls] = await Promise.all([
      sessionRows(f),
      orderStats(f),
      aiStats(f, [String(tenant.subdomain)]),
      db().collection('serviceRequests').countDocuments({
        tenantId: f.tenantId,
        createdAt: { $gte: since },
        ...(f.locationId ? { locationId: f.locationId } : {}),
      }),
    ]);
    const [series, byHour, byWeekday, topItems, byBranch] = await Promise.all([
      dailySeries(f, rows),
      // when orders come in (the restaurant's own clock)
      ordersCol()
        .aggregate([
          { $match: { ...orderMatch, status: { $ne: 'cancelled' } } },
          { $group: { _id: { $hour: { date: '$createdAt', timezone: tz } }, orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      ordersCol()
        .aggregate([
          { $match: { ...orderMatch, status: { $ne: 'cancelled' } } },
          { $group: { _id: { $dayOfWeek: { date: '$createdAt', timezone: tz } }, orders: { $sum: 1 } } },
        ])
        .toArray(),
      ordersCol()
        .aggregate([
          { $match: { ...orderMatch, status: { $ne: 'cancelled' } } },
          { $unwind: '$items' },
          { $group: { _id: '$items.itemId', name: { $last: '$items.name' }, qty: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotal' } } },
          { $sort: { qty: -1 } },
          { $limit: 8 },
        ])
        .toArray(),
      // every branch side by side — only when looking at them combined
      f.locationId
        ? Promise.resolve([] as Document[])
        : ordersCol()
            .aggregate([
              { $match: orderMatch },
              {
                $group: {
                  _id: '$locationId',
                  orders: { $sum: 1 },
                  revenue: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$total', 0] } },
                  dineIn: { $sum: { $cond: [{ $eq: ['$channel', 'dine-in'] }, 1, 0] } },
                },
              },
            ])
            .toArray(),
    ]);
    const locs = await db().collection('locations').find({ tenantId: f.tenantId }, { projection: { name: 1 } }).toArray();
    const names = new Map(locs.map((l) => [String(l._id), String(l.name)]));
    const sessionsBy = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.locationId ?? '';
      (sessionsBy.get(k) ?? sessionsBy.set(k, []).get(k)!).push(r);
    }
    const hours = Array.from({ length: 24 }, (_, h) => {
      const x = byHour.find((b) => b._id === h);
      return { hour: h, orders: x?.orders ?? 0, revenue: Math.round(Number(x?.revenue || 0)) };
    });
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => ({
      day: d,
      orders: byWeekday.find((w) => w._id === i + 1)?.orders ?? 0,
    }));
    res.json({
      success: true,
      days: f.days,
      branch: f.locationId ? names.get(String(f.locationId)) ?? null : null,
      timezone: tz,
      funnel: funnel(rows),
      orders,
      ai,
      waiterCalls: calls,
      series,
      byHour: hours,
      byWeekday: weekdays,
      topItems: topItems.map((t) => ({ itemId: String(t._id), name: t.name, qty: t.qty, revenue: Math.round(Number(t.revenue || 0)) })),
      byBranch: (byBranch as Document[])
        .filter((b) => b._id)
        .map((b) => {
          const fun = funnel(sessionsBy.get(String(b._id)) ?? []);
          return {
            locationId: String(b._id),
            branch: names.get(String(b._id)) ?? 'Deleted branch',
            orders: b.orders,
            revenue: Math.round(Number(b.revenue || 0)),
            dineIn: b.dineIn,
            online: b.orders - b.dineIn,
            sessions: fun.sessions,
            visitToOrder: fun.rates.visitToOrder,
          };
        })
        .sort((a, b) => b.revenue - a.revenue),
    });
  })
);

/* ------------------------------------------------------------------ dishes */

router.get(
  '/insights/menu',
  ...guard,
  wrap(async (req, res) => {
    const s = await scopeOf(req);
    if (!s) return res.status(404).json({ success: false, message: 'Not found' });
    const { f } = s;
    const since = sinceOf(f.days);
    const orderMatch: Document = {
      tenantId: f.tenantId,
      createdAt: { $gte: since },
      status: { $ne: 'cancelled' },
      ...(f.locationId ? { locationId: f.locationId } : {}),
      ...(f.channel ? { channel: f.channel } : {}),
    };
    const [sold, totalOrders, suggestedAdds, addedToTray, items] = await Promise.all([
      ordersCol()
        .aggregate([
          { $match: orderMatch },
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.itemId',
              name: { $last: '$items.name' },
              qty: { $sum: '$items.qty' },
              revenue: { $sum: '$items.lineTotal' },
              orders: { $sum: 1 },
              byWaiter: { $sum: { $cond: [{ $eq: ['$source', 'ai-waiter'] }, '$items.qty', 0] } },
              dineIn: { $sum: { $cond: [{ $eq: ['$channel', 'dine-in'] }, '$items.qty', 0] } },
              last: { $max: '$createdAt' },
            },
          },
        ])
        .toArray(),
      ordersCol().countDocuments(orderMatch),
      // dishes the AI waiter suggested / offered that guests then added
      eventsCol()
        .aggregate([
          {
            $match: {
              tenantId: f.tenantId,
              type: 'suggestion_added',
              at: { $gte: since },
              ...(f.locationId ? { locationId: f.locationId } : {}),
              ...(f.channel ? { channel: f.channel } : {}),
            },
          },
          { $group: { _id: '$data.itemId', n: { $sum: 1 } } },
        ])
        .toArray(),
      // added to a tray (bought or not)
      eventsCol()
        .aggregate([
          {
            $match: {
              tenantId: f.tenantId,
              type: 'item_added',
              at: { $gte: since },
              ...(f.locationId ? { locationId: f.locationId } : {}),
              ...(f.channel ? { channel: f.channel } : {}),
            },
          },
          { $group: { _id: '$data.itemId', n: { $sum: 1 } } },
        ])
        .toArray(),
      db()
        .collection('menuItems')
        .find({ tenantId: f.tenantId }, { projection: { name: 1, price: 1, status: 1, hidden: 1, category: 1, categoryId: 1, locationId: 1 } })
        .toArray(),
    ]);
    // another branch's own categories (scope "location") aren't on this branch's menu either
    const otherBranchCats = f.locationId
      ? new Set(
          (
            await db()
              .collection('categories')
              .find({ tenantId: f.tenantId, scope: 'location', locationId: { $ne: f.locationId } }, { projection: { _id: 1 } })
              .toArray()
          ).map((c) => String(c._id))
        )
      : new Set<string>();
    const soldBy = new Map(sold.map((x) => [String(x._id), x]));
    const sugBy = new Map(suggestedAdds.map((x) => [String(x._id), x.n as number]));
    const addBy = new Map(addedToTray.map((x) => [String(x._id), x.n as number]));
    const totalRevenue = sold.reduce((sum, x) => sum + Number(x.revenue || 0), 0) || 1;
    const rows = items
      // a branch's view: no other branch's own dishes
      .filter(
        (it) =>
          !f.locationId ||
          ((!it.locationId || String(it.locationId) === String(f.locationId)) && !otherBranchCats.has(String(it.categoryId ?? '')))
      )
      .map((it) => {
        const id = String(it._id);
        const x = soldBy.get(id);
        return {
          itemId: id,
          name: String(it.name),
          category: it.category ?? null,
          price: it.price ?? null,
          active: it.status !== 'hidden' && !it.hidden,
          qty: x?.qty ?? 0,
          revenue: Math.round(Number(x?.revenue || 0)),
          revenueShare: x ? Math.round((Number(x.revenue || 0) / totalRevenue) * 1000) / 1000 : 0,
          inOrders: x?.orders ?? 0,
          orderShare: totalOrders ? Math.round(((x?.orders ?? 0) / totalOrders) * 1000) / 1000 : 0,
          byWaiter: x?.byWaiter ?? 0,
          dineIn: x?.dineIn ?? 0,
          online: (x?.qty ?? 0) - (x?.dineIn ?? 0),
          addedToTray: addBy.get(id) ?? 0,
          suggestedAdds: sugBy.get(id) ?? 0,
          lastSold: x?.last ?? null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty);
    res.json({ success: true, days: f.days, orders: totalOrders, items: rows });
  })
);

/* ------------------------------------------------------------------ the home dashboard */

type Row = SessionRow;
type OrderDoc = { total?: number; channel?: string; status?: string; source?: string; createdAt: Date; locationId?: ObjectId };
const CHANNELS = ['dine-in', 'online'] as const;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : null);

/** The headline numbers for a set of visits and their orders. */
function summary(rows: Row[], orders: OrderDoc[], returning?: Set<string>) {
  const live = orders.filter((o) => o.status !== 'cancelled');
  const revenue = live.reduce((s, o) => s + Number(o.total || 0), 0);
  const fun = funnel(rows);
  const devices = new Set(rows.map((r) => r.did).filter(Boolean));
  const back = returning ? [...devices].filter((d) => returning.has(d)).length : 0;
  // left without doing anything: one page, never talked to the waiter, nothing in the tray
  const bounced = rows.filter((r) => r.views <= 1 && !r.engaged && r.itemsAdded === 0 && !r.checkout && !r.ordered).length;
  return {
    scans: fun.scans,
    guests: fun.sessions,
    scannedGuests: fun.scannedSessions,
    uniqueDevices: devices.size,
    returningGuests: back,
    newGuests: devices.size - back,
    engagedGuests: fun.engagedSessions,
    cartGuests: fun.cartSessions,
    checkoutGuests: fun.checkoutSessions,
    orderingGuests: fun.orderedSessions,
    conversion: fun.rates.visitToOrder,
    scanToOrder: fun.rates.scanToOrder,
    engagement: fun.rates.engagement,
    bounceRate: pct(bounced, rows.length),
    avgMinutes: fun.avgMinutes,
    medianMinutes: fun.medianMinutes,
    pagesPerGuest: rows.length ? r1(fun.pageViews / rows.length) : null,
    waiterCalls: fun.waiterCalls,
    orders: orders.length,
    cancelled: orders.length - live.length,
    revenue: Math.round(revenue),
    avgOrderValue: live.length ? Math.round(revenue / live.length) : null,
    aiOrders: live.filter((o) => o.source === 'ai-waiter').length,
  };
}

/**
 * GET /insights/dashboard?range=today|yesterday|7d|30d|month|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&channel=&location=
 * The home dashboard: QR scans and how guests behave, dine-in vs online side by side, each number next to the
 * period before it; charts in the restaurant's own time (by hour for one day, by day for longer).
 */
router.get(
  '/insights/dashboard',
  ...guard,
  wrap(async (req, res) => {
    const s = await scopeOf(req);
    if (!s) return res.status(404).json({ success: false, message: 'Not found' });
    const { f: base, tenant } = s;
    const tz = String(tenant.timezone || 'Asia/Dhaka');
    const p = periodOf(req.query.range, req.query.from, req.query.to, tz);
    const channel = base.channel ?? null; // the page's filter; the dine-in / online comparison always shows both
    const scope = { ...base, channel: null };
    const cur: Filters = { ...scope, from: p.from, to: p.to };
    const prev: Filters = { ...scope, from: p.prevFrom, to: p.prevTo };
    const orderFind = (f: Filters) =>
      ordersCol()
        .find(
          { tenantId: f.tenantId, createdAt: { $gte: f.from, $lt: f.to }, ...(f.locationId ? { locationId: f.locationId } : {}) },
          { projection: { total: 1, channel: 1, status: 1, source: 1, createdAt: 1, locationId: 1 } }
        )
        .toArray() as unknown as Promise<OrderDoc[]>;

    const [rowsAll, prevRowsAll, ordersAll, prevOrdersAll] = await Promise.all([
      sessionRows(cur),
      sessionRows(prev),
      orderFind(cur),
      orderFind(prev),
    ]);
    // devices seen here before this period → returning guests
    const dids = [...new Set(rowsAll.map((r) => r.did).filter(Boolean))];
    const seenBefore = dids.length
      ? new Set(
          (await eventsCol().distinct('did', {
            tenantId: base.tenantId,
            did: { $in: dids },
            at: { $lt: p.from },
            ...(base.locationId ? { locationId: base.locationId } : {}),
          })) as string[]
        )
      : new Set<string>();
    const prevDids = [...new Set(prevRowsAll.map((r) => r.did).filter(Boolean))];
    const prevSeenBefore = prevDids.length
      ? new Set(
          (await eventsCol().distinct('did', {
            tenantId: base.tenantId,
            did: { $in: prevDids },
            at: { $lt: p.prevFrom },
            ...(base.locationId ? { locationId: base.locationId } : {}),
          })) as string[]
        )
      : new Set<string>();

    const pick = <T extends { channel?: string }>(list: T[], ch: string | null) => (ch ? list.filter((x) => x.channel === ch) : list);
    const rows = pick(rowsAll, channel);
    const prevRows = pick(prevRowsAll, channel);
    const orders = pick(ordersAll, channel);
    const prevOrders = pick(prevOrdersAll, channel);

    // charts: one point per hour (one day) or per day, in the restaurant's time
    const keys = p.bucket === 'hour' ? Array.from({ length: 24 }, (_, h) => String(h)) : datesOf(p);
    const keyOf = (at: Date) => {
      const x = localHourAndDate(new Date(at), tz);
      return p.bucket === 'hour' ? String(x.hour) : x.date;
    };
    const blank = () => ({ scans: 0, guests: 0, dineInGuests: 0, onlineGuests: 0, orders: 0, dineInOrders: 0, onlineOrders: 0, revenue: 0 });
    const fill = (rs: Row[], os: OrderDoc[], shift = 0) => {
      const m = new Map(keys.map((k) => [k, blank()]));
      for (const r of rs) {
        const b = m.get(keyOf(new Date(new Date(r.first).getTime() + shift)));
        if (!b) continue;
        b.scans += r.scans;
        b.guests += 1;
        if (r.channel === 'dine-in') b.dineInGuests += 1;
        else b.onlineGuests += 1;
      }
      for (const o of os) {
        const b = m.get(keyOf(new Date(new Date(o.createdAt).getTime() + shift)));
        if (!b) continue;
        b.orders += 1;
        if (o.channel === 'dine-in') b.dineInOrders += 1;
        else b.onlineOrders += 1;
        if (o.status !== 'cancelled') b.revenue += Number(o.total || 0);
      }
      return keys.map((k) => ({ key: k, ...m.get(k)!, revenue: Math.round(m.get(k)!.revenue) }));
    };
    const shift = p.from.getTime() - p.prevFrom.getTime(); // the previous period laid over this one
    const series = fill(rows, orders);
    const prevSeries = fill(prevRows, prevOrders, shift);

    // when guests come: scans and guests by hour of day (over the whole period)
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, scans: 0, guests: 0, orders: 0 }));
    for (const r of rows) {
      const h = localHourAndDate(new Date(r.first), tz).hour;
      byHour[h].scans += r.scans;
      byHour[h].guests += 1;
    }
    for (const o of orders) byHour[localHourAndDate(new Date(o.createdAt), tz).hour].orders += 1;

    // tables: which QR codes get scanned, and how often a scan turns into an order
    const tables = new Map<string, { table: string; scans: number; guests: number; ordered: number; minutes: number }>();
    for (const r of rowsAll) {
      if (r.channel !== 'dine-in' || !r.table) continue;
      const t = tables.get(r.table) ?? { table: r.table, scans: 0, guests: 0, ordered: 0, minutes: 0 };
      t.scans += r.scans;
      t.guests += 1;
      t.ordered += r.ordered ? 1 : 0;
      t.minutes += r.minutes;
      tables.set(r.table, t);
    }
    const tableList = [...tables.values()]
      .map((t) => ({ table: t.table, scans: t.scans, guests: t.guests, ordered: t.ordered, conversion: pct(t.ordered, t.guests), avgMinutes: r1(t.minutes / t.guests) }))
      .sort((a, b) => b.scans - a.scans || b.guests - a.guests);

    const devices = { mobile: 0, tablet: 0, desktop: 0 } as Record<string, number>;
    for (const r of rows) devices[r.device ?? 'mobile'] = (devices[r.device ?? 'mobile'] ?? 0) + 1;

    // guests on the menu right now (something in the last 5 minutes)
    let now: { total: number; dineIn: number; online: number } | null = null;
    if (p.includesNow) {
      const recent = await eventsCol()
        .aggregate([
          { $match: { tenantId: base.tenantId, at: { $gte: new Date(Date.now() - 5 * 60_000) }, ...(base.locationId ? { locationId: base.locationId } : {}) } },
          { $group: { _id: '$vid', channel: { $first: '$channel' } } },
        ])
        .toArray();
      now = {
        total: recent.length,
        dineIn: recent.filter((x) => x.channel === 'dine-in').length,
        online: recent.filter((x) => x.channel !== 'dine-in').length,
      };
    }

    // every branch side by side (all branches combined only)
    let branches: unknown[] = [];
    if (!base.locationId) {
      const locs = await client.db('authDB').collection('locations').find({ tenantId: base.tenantId }, { projection: { name: 1 } }).toArray();
      if (locs.length > 1) {
        branches = locs
          .map((l) => {
            const id = String(l._id);
            const rs = rows.filter((r) => r.locationId === id);
            const os = orders.filter((o) => String(o.locationId ?? '') === id);
            const sm = summary(rs, os);
            return {
              locationId: id,
              name: String(l.name),
              scans: sm.scans,
              guests: sm.guests,
              dineInGuests: rs.filter((r) => r.channel === 'dine-in').length,
              onlineGuests: rs.filter((r) => r.channel !== 'dine-in').length,
              orders: sm.orders,
              revenue: sm.revenue,
              conversion: sm.conversion,
              avgMinutes: sm.avgMinutes,
            };
          })
          .sort((a, b) => b.guests - a.guests);
      }
    }

    res.json({
      success: true,
      period: { key: p.key, from: p.fromDate, to: p.toDate, bucket: p.bucket, includesNow: p.includesNow, timezone: tz },
      branch: base.locationId ? String(base.locationId) : null,
      channel,
      now,
      summary: summary(rows, orders, seenBefore),
      previous: summary(prevRows, prevOrders, prevSeenBefore),
      channels: Object.fromEntries(
        CHANNELS.map((ch) => [
          ch,
          {
            current: summary(pick(rowsAll, ch), pick(ordersAll, ch), seenBefore),
            previous: summary(pick(prevRowsAll, ch), pick(prevOrdersAll, ch), prevSeenBefore),
            funnel: funnel(pick(rowsAll, ch)),
          },
        ])
      ),
      series,
      prevSeries,
      byHour,
      tables: tableList.slice(0, 12),
      devices,
      branches,
    });
  })
);

export default router;
