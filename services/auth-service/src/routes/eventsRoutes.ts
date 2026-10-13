// services/auth-service/src/routes/eventsRoutes.ts
// POST /api/v1/public/events — what guests do in the storefront (apps/tastebud/src/utils/track.ts), for Cortex:
// QR scans, page visits, talking to the AI waiter, suggestions, checkout, orders, waiter calls, time on the page.
// No personal data: a random device id, a visit id, the restaurant / branch / channel / table, and the event.
// Kept a year (TTL index in initDb).
import express, { type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import { resolveBranchLocationId } from '../controllers/categoriesController.js';
import { branchForUnnamed } from '../utils/branches.js';

const router: express.Router = express.Router();

export const GUEST_EVENT_TYPES = [
  'scan', // landed from a QR code (a table's, or an online code)
  'visit', // a page view (page: home | menu | checkout | order)
  'waiter_start', // tapped "Get started" — talking to the AI waiter
  'ai_turn', // the AI waiter answered
  'suggestions_opened', // looked at the AI's suggestions
  'suggestion_added', // added a suggested / offered dish
  'item_added', // anything added to the tray
  'checkout_started', // opened checkout with something in the tray
  'order_placed', // the order went in (data: token, orderNumber, total)
  'call_waiter', // called staff from the table
  'ping', // still on the page (every minute while visible) — for time spent
] as const;
type GuestEventType = (typeof GUEST_EVENT_TYPES)[number];
const TYPES = new Set<string>(GUEST_EVENT_TYPES);
const PAGES = new Set(['home', 'menu', 'checkout', 'order', 'other']);

export const guestEvents = () => client.db('authDB').collection('guestEvents');

// restaurant + branch lookups are cached briefly (every page of every guest posts here)
const tenantCache = new Map<string, { at: number; id: ObjectId | null }>();
const branchCache = new Map<string, { at: number; id: ObjectId | null }>();
const TTL_MS = 5 * 60 * 1000;

async function tenantIdOf(sub: string): Promise<ObjectId | null> {
  const hit = tenantCache.get(sub);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.id;
  const t = await client.db('authDB').collection('tenants').findOne({ subdomain: sub }, { projection: { _id: 1 } });
  const id = (t?._id as ObjectId | undefined) ?? null;
  if (tenantCache.size > 5000) tenantCache.clear();
  tenantCache.set(sub, { at: Date.now(), id });
  return id;
}

async function locationIdOf(tenantId: ObjectId, branch: string | null): Promise<ObjectId | null> {
  const key = `${tenantId}|${branch ?? ''}`;
  const hit = branchCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.id;
  // no branch in the link → the branch its orders go to (the only one, or the main link's), as orders do
  const id = branch ? await resolveBranchLocationId(tenantId, branch) : (await branchForUnnamed(tenantId)).locationId;
  if (branchCache.size > 5000) branchCache.clear();
  branchCache.set(key, { at: Date.now(), id });
  return id;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** "mobile" | "tablet" | "desktop" — the only thing kept from the user agent. */
function deviceClass(ua: string): string {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}

router.post('/public/events', async (req: Request, res: Response) => {
  try {
    const ctx = (req.body?.ctx ?? {}) as Record<string, unknown>;
    const list = Array.isArray(req.body?.events) ? (req.body.events as Array<Record<string, unknown>>).slice(0, 50) : [];
    const sub = str(ctx.sub, 64).toLowerCase();
    const did = str(ctx.did, 64);
    const vid = str(ctx.vid, 64);
    if (!sub || !did || !vid || !list.length) return res.status(204).end();
    const tenantId = await tenantIdOf(sub);
    if (!tenantId) return res.status(204).end();
    const branch = str(ctx.branch, 64) || null;
    const locationId = await locationIdOf(tenantId, branch);
    const channel = ctx.channel === 'dine-in' ? 'dine-in' : 'online';
    const table = channel === 'dine-in' ? str(ctx.table, 12) || null : null;
    const device = deviceClass(String(req.headers['user-agent'] || ''));
    const now = Date.now();

    const docs = list
      .filter((e) => TYPES.has(String(e.type)))
      .map((e) => {
        // the client's clock, kept within an hour of ours (batches are sent a few seconds late)
        const t = Number(e.at);
        const at = new Date(Number.isFinite(t) && Math.abs(now - t) < 3600_000 ? t : now);
        const page = PAGES.has(String(e.page)) ? String(e.page) : undefined;
        const raw = (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
        // a few known fields only (nothing free-form from the guest)
        const data: Record<string, unknown> = {};
        for (const k of ['itemId', 'token', 'source', 'kind']) if (typeof raw[k] === 'string') data[k] = str(raw[k], 64);
        for (const k of ['orderNumber', 'total', 'qty']) if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) data[k] = raw[k];
        return {
          tenantId,
          sub,
          locationId,
          branch,
          channel,
          table,
          did,
          vid,
          type: String(e.type) as GuestEventType,
          ...(page ? { page } : {}),
          ...(Object.keys(data).length ? { data } : {}),
          device,
          at,
        };
      });
    if (docs.length) await guestEvents().insertMany(docs, { ordered: false });
    return res.status(204).end();
  } catch {
    return res.status(204).end(); // tracking never bothers the guest
  }
});

export default router;
