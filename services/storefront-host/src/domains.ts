// services/storefront-host/src/domains.ts
// Which restaurant a host name is ("burgerhouse.com", "www.burgerhouse.com", "burger-house.qravy.com") and its own
// domain, from auth-service (/api/v1/public/domain). Asked on every page load and by Caddy's TLS check, so answers are
// kept for a minute (a miss for half a minute).
import type { IncomingHttpHeaders } from 'http';

export type HostInfo = {
  subdomain: string;
  domain: {
    host: string;
    primary: string;
    hosts: string[];
    connected: boolean;
    redirect: boolean;
    https: boolean;
  } | null;
};

const HIT_MS = 60_000;
const MISS_MS = 30_000;
const cache = new Map<string, { at: number; info: HostInfo | null }>();

/** A name that can't be a restaurant's domain: localhost, an IP, no dot. */
const notADomain = (h: string) => !h.includes('.') || /^\d+(\.\d+){3}$/.test(h) || h.startsWith('[') || h.endsWith('.localhost');

export function hostOf(headers: IncomingHttpHeaders): string {
  const raw = (headers['x-forwarded-host'] as string | undefined) ?? headers.host ?? '';
  return (raw.split(',')[0] ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

export async function lookupHost(gatewayUrl: string, host: string): Promise<HostInfo | null> {
  if (!host || notADomain(host)) return null;
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < (hit.info ? HIT_MS : MISS_MS)) return hit.info;
  try {
    const r = await fetch(`${gatewayUrl}/api/v1/public/domain?host=${encodeURIComponent(host)}`, {
      signal: AbortSignal.timeout(4000),
    });
    const info = r.ok ? ((await r.json()) as HostInfo) : null;
    if (r.ok || r.status === 404) cache.set(host, { at: Date.now(), info });
    if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
    return info;
  } catch {
    return hit?.info ?? null; // auth-service briefly away: the last answer, else nothing
  }
}

/** Where a page request on this host should go instead, or null to serve it here:
 *   - "burger-house.qravy.com/…" → the restaurant's own domain, when connected, secured and the owner wants that;
 *   - "burgerhouse.com" ↔ "www.burgerhouse.com" → the one the owner picked.
 *  Only once HTTPS works on the domain — a guest is never sent to a certificate warning. */
export function redirectTarget(host: string, info: HostInfo | null, isQravyHost: boolean): string | null {
  const d = info?.domain;
  if (!d || !d.connected || !d.https || host === d.primary) return null;
  if (isQravyHost) return d.redirect ? d.primary : null;
  return d.hosts.includes(host) ? d.primary : null;
}

/* ------------------------------------------------------------------ the restaurant's name and icons for the page */

export type TenantCard = { name: string; logoUrl: string | null; faviconUrl: string | null };
const cards = new Map<string, { at: number; card: TenantCard | null }>();

/** Name, logo and favicon for the page's <title>, icon and link previews (kept a minute). */
export async function tenantCard(gatewayUrl: string, sub: string): Promise<TenantCard | null> {
  const hit = cards.get(sub);
  if (hit && Date.now() - hit.at < HIT_MS) return hit.card;
  try {
    const r = await fetch(`${gatewayUrl}/api/v1/public/tenant?subdomain=${encodeURIComponent(sub)}`, { signal: AbortSignal.timeout(3000) });
    const item = r.ok ? ((await r.json()) as { item?: { name?: string; logoUrl?: string | null; faviconUrl?: string | null } }).item : null;
    const card = item?.name ? { name: String(item.name), logoUrl: item.logoUrl ?? null, faviconUrl: item.faviconUrl ?? null } : null;
    if (r.ok || r.status === 404) cards.set(sub, { at: Date.now(), card });
    if (cards.size > 5000) cards.delete(cards.keys().next().value as string);
    return card;
  } catch {
    return hit?.card ?? null;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The page's title, icon and link-preview tags for this restaurant ("Burger House · Order online"). */
export function brandHead(html: string, card: TenantCard, dineIn: boolean, pageUrl: string): string {
  const title = `${card.name} · ${dineIn ? 'Dine-in' : 'Order online'}`;
  const desc = dineIn
    ? `Order from your table at ${card.name} — browse the menu or just ask the AI waiter.`
    : `Order online from ${card.name} — browse the menu or just ask the AI waiter.`;
  const icon = card.faviconUrl || card.logoUrl;
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  out = out.replace(/<meta name="description"[^>]*>/i, `<meta name="description" content="${esc(desc)}" />`);
  if (icon) {
    out = out
      .replace(/<link rel="icon"[^>]*>/i, `<link rel="icon" href="${esc(icon)}" />`)
      .replace(/<link rel="apple-touch-icon"[^>]*>/i, `<link rel="apple-touch-icon" href="${esc(card.logoUrl || icon)}" />`);
  }
  const og = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(card.name)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(pageUrl)}" />`,
    ...(card.logoUrl ? [`<meta property="og:image" content="${esc(card.logoUrl)}" />`] : []),
    `<meta name="twitter:card" content="summary" />`,
  ].join('\n    ');
  return out.replace('</head>', `    ${og}\n  </head>`);
}
