// services/auth-service/src/utils/subdomains.ts
// A restaurant's subdomain: its storefront lives at <subdomain>.qravy.com. Lowercase letters, numbers and single
// dashes, 3–32 long; our own hosts' names are off limits. When one is taken, onboarding offers free ones close to it.
import type { Collection } from 'mongodb';

export const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'dashboard', 'auth', 'login', 'mail', 'email', 'smtp', 'ftp',
  'cdn', 'static', 'assets', 'img', 'images', 'media', 'menu', 'order', 'orders', 'waiter',
  'staging', 'dev', 'test', 'demo', 'status', 'docs', 'help', 'support', 'blog', 'cname',
  'ns1', 'ns2', 'qravy',
]);

export function isValidSubdomain(s: string): boolean {
  return /^[a-z0-9-]{3,32}$/.test(s) && !s.startsWith('-') && !s.endsWith('-') && !s.includes('--');
}

/** "burger-house" → burger-house-bd, the-burger-house, burger-house-2, … (valid, not reserved; not yet checked). */
export function subdomainCandidates(base: string): string[] {
  const b = base.replace(/-+$/, '').slice(0, 26);
  const out = [`${b}-bd`, `the-${b}`, `${b}-restaurant`, `${b}-kitchen`, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${b}-${n}`)];
  return [...new Set(out)].filter((s) => isValidSubdomain(s) && !RESERVED_SUBDOMAINS.has(s));
}

/** Is it free? If not, why — and up to three free ones to pick instead. */
export async function checkSubdomain(
  tenants: Collection<any>, // eslint-disable-line @typescript-eslint/no-explicit-any -- tenants, any doc shape
  raw: string
): Promise<{ subdomain: string; available: boolean; reason?: 'invalid' | 'reserved' | 'taken'; suggestions: string[] }> {
  const subdomain = String(raw || '').trim().toLowerCase();
  if (!isValidSubdomain(subdomain)) return { subdomain, available: false, reason: 'invalid', suggestions: [] };

  const reserved = RESERVED_SUBDOMAINS.has(subdomain);
  if (!reserved && !(await tenants.findOne({ subdomain }, { projection: { _id: 1 } }))) {
    return { subdomain, available: true, suggestions: [] };
  }

  const candidates = subdomainCandidates(subdomain);
  const taken = new Set(
    (await tenants.find({ subdomain: { $in: candidates } }, { projection: { subdomain: 1 } }).toArray()).map(
      (t) => t.subdomain as string
    )
  );
  return {
    subdomain,
    available: false,
    reason: reserved ? 'reserved' : 'taken',
    suggestions: candidates.filter((c) => !taken.has(c)).slice(0, 3),
  };
}
