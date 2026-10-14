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
