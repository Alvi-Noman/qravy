// services/auth-service/src/routes/supportRoutes.ts — Qravy support access ("log in as", services/supportSessions.ts)
//   Cortex:     POST /cortex/restaurants/:id/support-session  { reason? } → a one-time link that opens that restaurant's
//                                                                         dashboard as an admin of it (1 hour)
//               GET  /cortex/restaurants/:id/support-sessions          → its sessions: who, when, why, what was changed
//               POST /cortex/support-sessions/:sid/end                 → ends one now
//   The restaurant: GET /tenants/me/support-access                     → when Qravy support was in their account
//                   POST /auth/support/end                             → "Exit" on the support bar
import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import { requireCortex } from '../utils/cortexAuth.js';
import { authenticateJWT } from '../middleware/auth.js';
import { generateRefreshToken } from '../utils/token.js';
import { SUPPORT_MINUTES, endSupportSession, newSupportSessionId, supportSessions, type SupportSession } from '../services/supportSessions.js';
import { handoverUaHash, handoversCol } from './handoverRoutes.js';
import logger from '../utils/logger.js';

const router: express.Router = express.Router();
const db = () => client.db('authDB');
const ADMIN_BASE = (process.env.FRONTEND_URL || 'https://admin.qravy.com').trim().replace(/\/$/, '');
const REFRESH_COOKIE_PATH = '/api/v1/auth';

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const view = (s: SupportSession, withActions = false) => ({
  id: s._id,
  tenantName: s.tenantName,
  by: s.by,
  reason: s.reason,
  startedAt: s.startedAt,
  expiresAt: s.expiresAt,
  endedAt: s.endedAt ?? null,
  endedHow: s.endedHow ?? (!s.endedAt && s.expiresAt.getTime() <= Date.now() ? 'expired' : null),
  active: !s.endedAt && s.expiresAt.getTime() > Date.now(),
  changes: (s.actions ?? []).length,
  ...(withActions ? { actions: (s.actions ?? []).slice(-200).reverse() } : {}),
});

/* ------------------------------------------------------------------ Cortex */

router.post(
  '/cortex/restaurants/:id/support-session',
  requireCortex,
  wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!ObjectId.isValid(id)) return res.status(404).json({ success: false, message: 'Restaurant not found' });
    const tenantOid = new ObjectId(id);
    const tenant = await db().collection('tenants').findOne({ _id: tenantOid }, { projection: { name: 1, ownerId: 1 } });
    if (!tenant) return res.status(404).json({ success: false, message: 'Restaurant not found' });
    // the account it acts through: the restaurant's owner (as an admin — never with the owner's own powers)
    const owner = await db()
      .collection('memberships')
      .findOne({ tenantId: tenantOid, role: 'owner', status: { $ne: 'revoked' } }, { projection: { userId: 1 } });
    const userId = (owner?.userId as ObjectId | undefined) ?? (tenant.ownerId as ObjectId | undefined);
    const user = userId ? await db().collection('users').findOne({ _id: userId }, { projection: { email: 1 } }) : null;
    if (!user) return res.status(409).json({ success: false, message: 'This restaurant has no owner account to open it with.' });

    const by = String(req.cortex?.email || 'Qravy');
    const reason = String(req.body?.reason ?? '').trim().slice(0, 200);
    const now = new Date();
    const session: SupportSession = {
      _id: newSupportSessionId(),
      tenantId: tenantOid,
      tenantName: String(tenant.name ?? ''),
      userId: user._id as ObjectId,
      by,
      reason,
      startedAt: now,
      expiresAt: new Date(now.getTime() + SUPPORT_MINUTES * 60_000),
      endedAt: null,
      actions: [],
    };
    await supportSessions().insertOne(session);

    // its own sign-in (ends with the session) — handed to the dashboard's address once, by this browser
    const refreshToken = generateRefreshToken(
      { id: String(user._id), email: user.email, tenantId: id, imp: session._id },
      SUPPORT_MINUTES * 60
    );
    const code = crypto.randomBytes(32).toString('base64url');
    await handoversCol().insertOne({ _id: code, refreshToken, ua: handoverUaHash(req), createdAt: now, replace: true });
    logger.info(`[support] ${by} opened ${tenant.name} (${id}) as admin${reason ? ` — ${reason}` : ''}`);
    return res.json({
      success: true,
      session: view(session),
      url: `${ADMIN_BASE}/api/v1/auth/handover-claim?code=${code}&to=${encodeURIComponent('/dashboard')}`,
    });
  })
);

router.get(
  '/cortex/restaurants/:id/support-sessions',
  requireCortex,
  wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!ObjectId.isValid(id)) return res.json({ success: true, items: [] });
    const docs = await supportSessions().find({ tenantId: new ObjectId(id) }).sort({ startedAt: -1 }).limit(50).toArray();
    return res.json({ success: true, items: docs.map((d) => view(d, true)) });
  })
);

router.post(
  '/cortex/support-sessions/:sid/end',
  requireCortex,
  wrap(async (req, res) => {
    await endSupportSession(String(req.params.sid || ''), 'ended in Cortex');
    return res.json({ success: true });
  })
);

/* ------------------------------------------------------------------ the restaurant */

router.get(
  '/tenants/me/support-access',
  authenticateJWT,
  wrap(async (req, res) => {
    const tenantId = req.user?.tenantId;
    if (!tenantId || !ObjectId.isValid(tenantId)) return res.json({ success: true, items: [] });
    const docs = await supportSessions().find({ tenantId: new ObjectId(tenantId) }).sort({ startedAt: -1 }).limit(50).toArray();
    return res.json({ success: true, items: docs.map((d) => view(d)) });
  })
);

/** The support bar's "Exit": ends the session, signs this browser out of it. */
router.post(
  '/auth/support/end',
  authenticateJWT,
  wrap(async (req, res) => {
    const imp = (req.user as { imp?: string } | undefined)?.imp;
    if (imp) await endSupportSession(imp, 'exit');
    res.clearCookie('refreshToken', { httpOnly: true, secure: true, sameSite: 'none', path: REFRESH_COOKIE_PATH });
    return res.json({ success: true });
  })
);

export default router;
