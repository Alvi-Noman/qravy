// services/auth-service/src/routes/domainRoutes.ts
// A restaurant's own domain (Settings → Domain): the owner adds "burgerhouse.com", adds two DNS records at their
// domain provider, we check them; once they're right the shop, dine-in, branches and table links all work on it, and
// (if they want) "burger-house.qravy.com" sends guests there. The Qravy address keeps working either way.
//   /tenants/me/domain            the owner's view (GET / PUT / PATCH / DELETE) — owners only, not from a branch login
//   /tenants/me/domain/check      check the DNS records now (and get the HTTPS certificate once they're right)
//   /public/domain?host=…         which restaurant a host belongs to — for storefront-host and the TLS check
import express, { type Request, type Response, type NextFunction } from 'express';
import { ObjectId, type Document } from 'mongodb';
import { client } from '../db.js';
import { authenticateJWT } from '../middleware/auth.js';
import { denyBranchSession } from '../middleware/scope.js';
import { authorize } from '../middleware/authorize.js';
import {
  checkRecords,
  detectProvider,
  hostsOf,
  parseDomain,
  QRAVY_ROOTS,
  recordsFor,
  targetIps,
  type ParsedDomain,
} from '../utils/customDomain.js';

const router: express.Router = express.Router();
const tenants = () => client.db('authDB').collection('tenants');

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export type CustomDomain = ParsedDomain & {
  status: 'pending' | 'connected';
  /** "burger-house.qravy.com" sends guests to the domain (once it's connected) */
  redirect: boolean;
  addedAt: Date;
  verifiedAt?: Date | null;
  checkedAt?: Date | null;
  /** the certificate answered on every host name of the domain */
  https?: boolean;
};

/** The Qravy address a domain points at: its own restaurant's ("burger-house.qravy.com"). */
const targetOf = (subdomain: string) => `${subdomain}.qravy.com`;

const guard = [authenticateJWT, denyBranchSession, authorize('settings:domain')];

async function myTenant(req: Request): Promise<Document | null> {
  const id = req.user?.tenantId;
  if (!id || !ObjectId.isValid(id)) return null;
  return tenants().findOne({ _id: new ObjectId(id) }, { projection: { subdomain: 1, customDomain: 1 } });
}

/** Everything the Domain page shows: the domain, its records (with what DNS says now, after a check), the provider. */
async function view(t: Document, checked?: Awaited<ReturnType<typeof checkRecords>>) {
  const cd = t.customDomain as CustomDomain | undefined;
  const target = targetOf(String(t.subdomain));
  if (!cd) return { qravyAddress: target, domain: null };
  const ips = await targetIps(target);
  return {
    qravyAddress: target,
    domain: {
      host: cd.host,
      kind: cd.kind,
      primary: cd.primary,
      hosts: hostsOf(cd),
      status: cd.status,
      redirect: cd.redirect,
      https: !!cd.https,
      addedAt: cd.addedAt,
      verifiedAt: cd.verifiedAt ?? null,
      checkedAt: cd.checkedAt ?? null,
      records: checked ?? recordsFor(cd, target, ips),
      provider: await detectProvider(cd.zone),
    },
  };
}

/** Ask each host name over HTTPS — the first visit is what gets Caddy to fetch its certificate. */
async function warmHttps(hosts: string[]): Promise<boolean> {
  const results = await Promise.all(
    hosts.map((h) =>
      fetch(`https://${h}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(20000) })
        .then(() => true)
        .catch(() => false)
    )
  );
  return results.every(Boolean);
}

/* ------------------------------------------------------------------ the owner's page */

router.get(
  '/tenants/me/domain',
  ...guard,
  wrap(async (req, res) => {
    const t = await myTenant(req);
    if (!t) return res.status(404).json({ message: 'Restaurant not found' });
    res.json(await view(t));
  })
);

router.put(
  '/tenants/me/domain',
  ...guard,
  wrap(async (req, res) => {
    const t = await myTenant(req);
    if (!t) return res.status(404).json({ message: 'Restaurant not found' });
    const d = parseDomain(req.body?.domain);
    if (!d) {
      return res.status(400).json({
        code: 'invalid',
        message: 'That doesn’t look like a domain. Type it like burgerhouse.com (without https:// or a page).',
      });
    }
    const taken = await tenants().findOne(
      { _id: { $ne: t._id }, 'customDomain.host': d.host },
      { projection: { _id: 1 } }
    );
    if (taken) {
      return res.status(409).json({ code: 'taken', message: `${d.host} is already connected to another restaurant on Qravy.` });
    }
    const cd: CustomDomain = { ...d, status: 'pending', redirect: true, addedAt: new Date(), verifiedAt: null, checkedAt: null, https: false };
    await tenants().updateOne({ _id: t._id }, { $set: { customDomain: cd, updatedAt: new Date() } });
    res.json(await view({ ...t, customDomain: cd }));
  })
);

router.post(
  '/tenants/me/domain/check',
  ...guard,
  wrap(async (req, res) => {
    const t = await myTenant(req);
    const cd = t?.customDomain as CustomDomain | undefined;
    if (!t || !cd) return res.status(404).json({ message: 'No domain to check' });
    const target = targetOf(String(t.subdomain));
    const ips = await targetIps(target);
    const checked = await checkRecords(recordsFor(cd, target, ips), target, ips);
    const ok = ips.length > 0 && checked.every((r) => r.ok);
    // records right → the certificate (first HTTPS visit); the redirect waits for it, so guests never see a warning
    const https = ok ? cd.https || (await warmHttps(hostsOf(cd))) : false;
    const next: CustomDomain = {
      ...cd,
      status: ok ? 'connected' : 'pending',
      verifiedAt: ok ? cd.verifiedAt ?? new Date() : cd.verifiedAt ?? null,
      checkedAt: new Date(),
      https,
    };
    await tenants().updateOne({ _id: t._id }, { $set: { customDomain: next } });
    res.json(await view({ ...t, customDomain: next }, checked));
  })
);

router.patch(
  '/tenants/me/domain',
  ...guard,
  wrap(async (req, res) => {
    const t = await myTenant(req);
    if (!t?.customDomain) return res.status(404).json({ message: 'No domain' });
    if (typeof req.body?.redirect !== 'boolean') return res.status(400).json({ message: 'redirect: true or false' });
    await tenants().updateOne({ _id: t._id }, { $set: { 'customDomain.redirect': req.body.redirect } });
    res.json(await view({ ...t, customDomain: { ...t.customDomain, redirect: req.body.redirect } }));
  })
);

router.delete(
  '/tenants/me/domain',
  ...guard,
  wrap(async (req, res) => {
    const t = await myTenant(req);
    if (!t) return res.status(404).json({ message: 'Restaurant not found' });
    await tenants().updateOne({ _id: t._id }, { $unset: { customDomain: '' }, $set: { updatedAt: new Date() } });
    res.json(await view({ ...t, customDomain: undefined }));
  })
);

/* ------------------------------------------------------------------ which restaurant is this host? */

/** For storefront-host (which restaurant, and whether to send guests to its own domain) and the TLS check (may this
 *  host get a certificate). "burger-house.qravy.com", "burgerhouse.com" and "www.burgerhouse.com" all answer. */
router.get(
  '/public/domain',
  wrap(async (req, res) => {
    const host = String(req.query.host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    if (!host || host.length > 253) return res.status(400).json({ message: 'host is required' });
    const root = QRAVY_ROOTS.find((r) => host.endsWith(`.${r}`));
    const filter = root
      ? { subdomain: host.slice(0, -(root.length + 1)) }
      : { 'customDomain.host': { $in: host.startsWith('www.') ? [host, host.slice(4)] : [host] } };
    const t = await tenants().findOne(filter, { projection: { subdomain: 1, customDomain: 1 } });
    const cd = t?.customDomain as CustomDomain | undefined;
    // "www.order.burgerhouse.com" is not part of a subdomain connection
    if (!t || (!root && cd && !hostsOf(cd).includes(host))) return res.status(404).json({ message: 'Not found' });
    res.set('Cache-Control', 'no-store');
    res.json({
      subdomain: t.subdomain,
      domain: cd
        ? { host: cd.host, primary: cd.primary, hosts: hostsOf(cd), connected: cd.status === 'connected', redirect: !!cd.redirect, https: !!cd.https }
        : null,
    });
  })
);

export default router;
