// services/auth-service/src/routes/handoverRoutes.ts
// The dashboard moved from app.qravy.com to admin.qravy.com. Cookies belong to one host, so without this everyone
// would be signed out and every paired branch tablet would forget its branch. On the old address Caddy sends each page
// here (under /api/v1/auth, so the sign-in cookie — path /api/v1/auth — comes along):
//   1. app.qravy.com/api/v1/auth/handover/<page>  → the browser's sign-in and device cookies go under a one-time code
//      (2 minutes, used once; the cookies themselves are never in a URL) → admin.qravy.com/…/handover-claim?code=…
//   2. admin.qravy.com/api/v1/auth/handover-claim → the same cookies set there → the page they asked for
// A browser with neither cookie goes straight to the new address.
import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { client } from '../db.js';

const router: express.Router = express.Router();
const handovers = () => client.db('authDB').collection<Handover>('handovers');

type Handover = { _id: string; refreshToken?: string; deviceKey?: string; ua: string; createdAt: Date };

const TTL_MS = 2 * 60 * 1000;
const ADMIN_BASE = (process.env.FRONTEND_URL || 'https://admin.qravy.com').trim().replace(/\/$/, '');

// as the sign-in and device cookies are set everywhere else (authController / accessController)
const REFRESH_OPTS = { httpOnly: true, secure: true, sameSite: 'none' as const, path: '/api/v1/auth', maxAge: 30 * 24 * 60 * 60 * 1000 };
const DEVICE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 365 * 24 * 60 * 60 * 1000,
};

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const uaHash = (req: Request) => crypto.createHash('sha256').update(String(req.headers['user-agent'] || '')).digest('hex');

/** Only a page on the dashboard itself: "/orders?x=1" — never another site ("//evil.com", "https://…"). */
function safePage(raw: unknown): string {
  const s = String(raw || '/');
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : '/';
}

router.get(
  /^\/handover(\/.*)?$/,
  wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // "/handover/orders?status=new" → "/orders?status=new"
    const q = req.originalUrl.indexOf('?');
    const pathPart = (req.params[0] as string | undefined) || '/';
    const page = safePage(pathPart + (q >= 0 ? req.originalUrl.slice(q) : ''));
    const refreshToken = typeof req.cookies?.refreshToken === 'string' ? req.cookies.refreshToken : undefined;
    const deviceKey = typeof req.cookies?.deviceKey === 'string' ? req.cookies.deviceKey : undefined;
    if (!refreshToken && !deviceKey) return res.redirect(302, `${ADMIN_BASE}${page}`);
    const code = crypto.randomBytes(32).toString('base64url');
    await handovers().insertOne({ _id: code, refreshToken, deviceKey, ua: uaHash(req), createdAt: new Date() });
    res.redirect(302, `${ADMIN_BASE}/api/v1/auth/handover-claim?code=${code}&to=${encodeURIComponent(page)}`);
  })
);

router.get(
  '/handover-claim',
  wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const page = safePage(req.query.to);
    const code = String(req.query.code || '');
    // once, by the same browser, within 2 minutes
    const h = code ? await handovers().findOneAndDelete({ _id: code }) : null;
    if (h && h.ua === uaHash(req) && Date.now() - h.createdAt.getTime() < TTL_MS) {
      if (h.refreshToken && !req.cookies?.refreshToken) res.cookie('refreshToken', h.refreshToken, REFRESH_OPTS);
      if (h.deviceKey && !req.cookies?.deviceKey) res.cookie('deviceKey', h.deviceKey, DEVICE_OPTS);
    }
    res.redirect(302, page);
  })
);

export default router;
