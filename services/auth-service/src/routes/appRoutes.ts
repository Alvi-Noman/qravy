/**
 * The restaurant's own app — its online shop added to a guest's home screen (a PWA), on Android and iPhone. No store,
 * no download: the phone installs the site itself, from this description of it (the "web app manifest") and its icons.
 *
 *   GET /public/app/:sub/manifest.webmanifest[?base=/t/<sub>&branch=<slug>]  — name, colours, icons, start page
 *   GET /public/app/:sub/icon-<180|192|512>.png[?m=1]                          — the icon, made from the logo
 *
 * The app always opens the ONLINE shop (delivery / pickup) — never a table, whatever page it was installed from.
 * Restaurants that don't sell online have no app (404). The guest site links the manifest on every page
 * (storefront-host writes it into the page; the app links it too, for its own address in development).
 */
import express, { type Request, type Response } from 'express';
import sharp from 'sharp';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { TenantDoc } from '../models/Tenant.js';

const router: express.Router = express.Router();

const SUB = /^[a-z0-9-]{1,63}$/;
/** where the guest site lives on this address: "" (the restaurant's own address) or "/t/<sub>" (development) */
const BASE = /^(\/t\/[a-z0-9-]{1,63})?$/;
const ICON_SIZES = new Set([180, 192, 512]);

type AppTenant = Pick<TenantDoc, 'name' | 'logoUrl' | 'logoBackground' | 'storefrontTheme' | 'waiterLanguage' | 'restaurantInfo'>;

async function tenantOf(sub: string): Promise<AppTenant | null> {
  if (!SUB.test(sub)) return null;
  return client
    .db('authDB')
    .collection<TenantDoc>('tenants')
    .findOne(
      { subdomain: sub },
      { projection: { name: 1, logoUrl: 1, logoBackground: 1, storefrontTheme: 1, waiterLanguage: 1, restaurantInfo: 1 } },
    );
}

/** Only restaurants that take online orders have an app (it opens the online shop). */
export const sellsOnline = (t: Pick<AppTenant, 'restaurantInfo'> | null) => !!t && t.restaurantInfo?.onlineSalesEnabled !== false;

/** The page colours the app opens with: Ember is dark, Petal light. */
export function appColors(t: Pick<AppTenant, 'storefrontTheme'>) {
  return t.storefrontTheme === 'ember' ? { background: '#0B0B0C', theme: '#0B0B0C' } : { background: '#FFFFFF', theme: '#FFFFFF' };
}

/** The short name under the icon (phones cut long names): the first words that fit 12 characters. */
export function shortName(name: string): string {
  const n = name.trim();
  if (n.length <= 12) return n;
  let out = '';
  for (const w of n.split(/\s+/)) {
    if ((out ? out.length + 1 : 0) + w.length > 12) break;
    out = out ? `${out} ${w}` : w;
  }
  return out || n.slice(0, 12);
}

/** The manifest (pure — unit-tested). `base`: "" or "/t/<sub>"; `branch`: a branch's link name, or null. */
export function appManifest(t: AppTenant, opts: { sub: string; base: string; branch: string | null }) {
  const home = `${opts.base}/${opts.branch ? `${opts.branch}/` : ''}`;
  const icon = (size: number, maskable = false) => ({
    src: `/api/v1/public/app/${opts.sub}/icon-${size}.png${maskable ? '?m=1' : ''}`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: maskable ? 'maskable' : 'any',
  });
  const { background, theme } = appColors(t);
  const name = (t.name || 'Order online').trim();
  return {
    id: home,
    name,
    short_name: shortName(name),
    description: `Order from ${name} — the menu, delivery and pickup, and the AI waiter.`,
    lang: t.waiterLanguage === 'en' ? 'en' : 'bn',
    // the online shop — never a table (the "source" tells home-screen opens apart in the numbers)
    start_url: `${home}?source=homescreen`,
    // the whole restaurant: a table's QR link opens in the app too, if it's installed
    scope: `${opts.base}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: background,
    theme_color: theme,
    icons: [icon(192), icon(512), icon(512, true)],
  };
}

/* ------------------------------------------------------------------ icons */

const iconCache = new Map<string, Buffer>();

/** The first letters of the name, on the restaurant's colour — when it has no logo yet. */
function initialsSvg(name: string, size: number, theme: AppTenant['storefrontTheme']) {
  const letters =
    name
      .split(/\s+/)
      .filter((w) => /^[\p{L}\p{N}]/u.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '•';
  const [bg, fg] = theme === 'ember' ? ['#F5A524', '#0B0B0C'] : ['#FA2851', '#FFFFFF'];
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${bg}"/>` +
      `<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${Math.round(size * 0.38)}" fill="${fg}">${letters.replace(/[<&>]/g, '')}</text></svg>`,
  );
}

async function fetchLogo(url: string): Promise<Buffer | null> {
  if (!/^https:\/\//i.test(url)) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 0 && buf.length < 6 * 1024 * 1024 ? buf : null;
  } catch {
    return null;
  }
}

/** A square app icon: the logo centred on its background (Branding → logo background), with room around it
 *  (more for "maskable" — Android crops those to a circle or a rounded square). No logo: the initials. */
export async function appIcon(t: AppTenant, size: number, maskable: boolean): Promise<Buffer> {
  const bg = t.logoBackground === 'black' ? '#000000' : '#FFFFFF';
  const key = `${t.name}|${t.logoUrl ?? ''}|${t.logoBackground ?? ''}|${t.storefrontTheme ?? ''}|${size}|${maskable ? 1 : 0}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const logo = t.logoUrl ? await fetchLogo(t.logoUrl) : null;
  let png: Buffer;
  if (logo) {
    const inner = Math.round(size * (maskable ? 0.62 : 0.8));
    const fitted = await sharp(logo).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    png = await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
      .composite([{ input: fitted, gravity: 'centre' }])
      .png()
      .toBuffer();
  } else {
    png = await sharp(initialsSvg(t.name || '', size, t.storefrontTheme)).png().toBuffer();
  }
  if (iconCache.size > 500) iconCache.delete(iconCache.keys().next().value as string);
  iconCache.set(key, png);
  return png;
}

/* ------------------------------------------------------------------ routes */

router.get('/public/app/:sub/manifest.webmanifest', async (req: Request, res: Response) => {
  try {
    const sub = String(req.params.sub || '').toLowerCase();
    const base = typeof req.query.base === 'string' ? req.query.base : '';
    const branch = typeof req.query.branch === 'string' && SUB.test(req.query.branch) ? req.query.branch : null;
    if (!BASE.test(base)) return res.status(400).json({ success: false, message: 'Bad base' });
    const t = await tenantOf(sub);
    if (!t || !sellsOnline(t)) return res.status(404).json({ success: false, message: 'No app for this restaurant' });
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(JSON.stringify(appManifest(t, { sub, base, branch })));
  } catch (e) {
    logger.error(`[app] manifest failed: ${(e as Error).message}`);
    return res.status(500).json({ success: false, message: 'Unavailable' });
  }
});

router.get('/public/app/:sub/icon-:size.png', async (req: Request, res: Response) => {
  try {
    const size = Number(req.params.size);
    if (!ICON_SIZES.has(size)) return res.status(404).end();
    const t = await tenantOf(String(req.params.sub || '').toLowerCase());
    if (!t) return res.status(404).end();
    const png = await appIcon(t, size, req.query.m === '1');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(png);
  } catch (e) {
    logger.error(`[app] icon failed: ${(e as Error).message}`);
    return res.status(500).end();
  }
});

export default router;
