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
} from '../services/cortex/analytics.js';

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

export default router;
