// services/auth-service/src/utils/customDomain.ts
// A restaurant's own domain ("burgerhouse.com") in front of its Qravy address ("burger-house.qravy.com"):
//   - what the owner typed → the domain we connect (www.burgerhouse.com → burgerhouse.com, with www as the main one)
//   - the DNS records they add at their domain provider
//   - checking those records in public DNS, and who their DNS provider is (for step-by-step help)
import { Resolver } from 'node:dns/promises';

/** Endings a domain is registered UNDER (burgerhouse.com.bd is a whole domain, not a subdomain of com.bd). */
const TWO_LEVEL_SUFFIXES = new Set([
  'com.bd', 'net.bd', 'org.bd', 'edu.bd', 'gov.bd', 'info.bd',
  'co.uk', 'org.uk', 'com.au', 'net.au', 'co.in', 'net.in', 'org.in', 'co.nz', 'com.sg', 'com.my', 'co.za',
  'com.pk', 'com.np', 'com.lk', 'ae.org', 'com.tr', 'com.br', 'com.mx', 'co.jp', 'com.cn', 'com.hk',
]);

export const QRAVY_ROOTS = ['qravy.com', 'onqravy.com'];

export type DomainKind = 'apex' | 'sub';
export type ParsedDomain = {
  /** the domain connected: "burgerhouse.com" or "order.burgerhouse.com" */
  host: string;
  /** apex: the domain itself; sub: a subdomain of one */
  kind: DomainKind;
  /** the registered domain ("burgerhouse.com"), where its DNS lives */
  zone: string;
  /** apex only: which address guests end up on — "www.burgerhouse.com" or "burgerhouse.com" */
  primary: string;
};

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** "https://www.BurgerHouse.com/menu" → { host: "burgerhouse.com", kind: "apex", primary: "www.burgerhouse.com" }.
 *  Null for anything that isn't a domain someone can own (no dot, an IP, a Qravy address, too long…). */
export function parseDomain(input: unknown): ParsedDomain | null {
  let s = String(input ?? '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (!s || s.length > 253 || /^\d+(\.\d+){3}$/.test(s)) return null;
  const labels = s.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,63}$|^xn--[a-z0-9-]+$/.test(labels.at(-1)!)) return null;
  if (QRAVY_ROOTS.some((r) => s === r || s.endsWith(`.${r}`))) return null;
  const zoneLen = TWO_LEVEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
  if (labels.length < zoneLen) return null; // "com.bd" alone
  const zone = labels.slice(-zoneLen).join('.');
  // "www.burgerhouse.com" = the domain itself, guests landing on www
  if (labels.length === zoneLen + 1 && labels[0] === 'www') return { host: zone, kind: 'apex', zone, primary: `www.${zone}` };
  if (s === zone) return { host: zone, kind: 'apex', zone, primary: zone };
  return { host: s, kind: 'sub', zone, primary: s };
}

/** Every host name a connected domain answers on: the domain, and www for a whole domain. */
export const hostsOf = (d: { host: string; kind: DomainKind }): string[] => (d.kind === 'apex' ? [d.host, `www.${d.host}`] : [d.host]);

export type DnsRecord = { type: 'A' | 'CNAME'; name: string; value: string; host: string };

/** What the owner adds at their DNS provider. "name" is how providers ask for it ("@", "www", "order"). */
export function recordsFor(d: ParsedDomain, target: string, ips: string[]): DnsRecord[] {
  if (d.kind === 'sub') {
    return [{ type: 'CNAME', name: d.host.slice(0, -(d.zone.length + 1)), value: target, host: d.host }];
  }
  return [
    ...ips.map((ip) => ({ type: 'A' as const, name: '@', value: ip, host: d.host })),
    { type: 'CNAME', name: 'www', value: target, host: `www.${d.host}` },
  ];
}

/* ------------------------------------------------------------------ DNS checks */

// ask public resolvers, not this server's cache — what the world sees is what counts
let resolver: Pick<Resolver, 'resolve4' | 'resolve6' | 'resolveCname' | 'resolveNs'> | null = null;
function dns() {
  if (!resolver) {
    const r = new Resolver({ timeout: 4000, tries: 2 });
    r.setServers(['1.1.1.1', '8.8.8.8']);
    resolver = r;
  }
  return resolver;
}
/** Tests swap in a fake resolver. */
export function setResolverForTests(r: typeof resolver): void {
  resolver = r;
}

const none = async <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);
const trimDot = (s: string) => s.toLowerCase().replace(/\.$/, '');

/** Cloudflare's proxy ("orange cloud") hides our address behind theirs — a common reason a record "doesn't work". */
function isCloudflare(ip: string): boolean {
  const ranges: Array<[string, number]> = [
    ['104.16.0.0', 13], ['172.64.0.0', 13], ['188.114.96.0', 20], ['162.158.0.0', 15], ['141.101.64.0', 18],
    ['108.162.192.0', 18], ['190.93.240.0', 20], ['197.234.240.0', 22], ['198.41.128.0', 17], ['173.245.48.0', 20],
    ['103.21.244.0', 22], ['103.22.200.0', 22], ['103.31.4.0', 22], ['131.0.72.0', 22],
  ];
  const n = (a: string) => a.split('.').reduce((x, o) => (x << 8) + Number(o), 0) >>> 0;
  return ranges.some(([base, bits]) => (n(ip) & (~0 << (32 - bits))) >>> 0 === (n(base) & (~0 << (32 - bits))) >>> 0);
}

export type RecordCheck = DnsRecord & {
  ok: boolean;
  /** what public DNS answers now for this name (IPs or a CNAME target) */
  found: string[];
  /** a plain-language reason when it isn't right yet */
  problem?: 'missing' | 'wrong' | 'extra' | 'cloudflare-proxy' | 'ipv6';
};

/** The Qravy address's own IPs ("burger-house.qravy.com" → the server) — the value for the A record. */
export async function targetIps(target: string): Promise<string[]> {
  return (await none(dns().resolve4(target))).sort();
}

/** Each record as public DNS sees it now. A CNAME counts as right when it points at the Qravy address, or when the
 *  name already resolves to our server some other way (an A record, a provider's "flattening"). */
export async function checkRecords(records: DnsRecord[], target: string, ips: string[]): Promise<RecordCheck[]> {
  const ours = new Set(ips);
  const out: RecordCheck[] = [];
  for (const r of records) {
    if (r.type === 'A') {
      // all A records of the name together: every one must be ours (a leftover one sends some guests elsewhere)
      if (out.some((o) => o.type === 'A' && o.host === r.host)) continue;
      const [found, v6] = await Promise.all([none(dns().resolve4(r.host)), none(dns().resolve6(r.host))]);
      const want = records.filter((x) => x.type === 'A' && x.host === r.host);
      const problem: RecordCheck['problem'] = !found.length
        ? 'missing'
        : found.every((ip) => ours.has(ip))
          ? v6.length
            ? 'ipv6'
            : undefined
          : found.some(isCloudflare)
            ? 'cloudflare-proxy'
            : found.some((ip) => ours.has(ip))
              ? 'extra'
              : 'wrong';
      for (const w of want) out.push({ ...w, ok: !problem, found: [...found, ...v6], ...(problem ? { problem } : {}) });
      continue;
    }
    const cname = (await none(dns().resolveCname(r.host))).map(trimDot);
    const viaA = cname.length ? [] : await none(dns().resolve4(r.host));
    const ok = cname.includes(trimDot(target)) || (viaA.length > 0 && viaA.every((ip) => ours.has(ip)));
    const problem: RecordCheck['problem'] = ok
      ? undefined
      : !cname.length && !viaA.length
        ? 'missing'
        : viaA.some(isCloudflare)
          ? 'cloudflare-proxy'
          : 'wrong';
    out.push({ ...r, ok, found: cname.length ? cname : viaA, ...(problem ? { problem } : {}) });
  }
  return out;
}

export type Provider = { id: string; name: string };

/** Where the domain's DNS is managed, from its name servers — so the guide shows that provider's steps. */
export async function detectProvider(zone: string): Promise<Provider | null> {
  const ns = (await none(dns().resolveNs(zone))).map(trimDot).join(' ');
  if (!ns) return null;
  const known: Array<[RegExp, string, string]> = [
    [/domaincontrol\.com/, 'godaddy', 'GoDaddy'],
    [/registrar-servers\.com|namecheaphosting/, 'namecheap', 'Namecheap'],
    [/cloudflare\.com/, 'cloudflare', 'Cloudflare'],
    [/googledomains\.com|squarespacedns|squarespace\.com/, 'squarespace', 'Squarespace Domains (formerly Google Domains)'],
    [/dns-parking\.com|hostinger/, 'hostinger', 'Hostinger'],
    [/awsdns/, 'route53', 'Amazon Route 53'],
    [/wixdns\.net/, 'wix', 'Wix'],
    [/name\.com/, 'namecom', 'Name.com'],
    [/porkbun/, 'porkbun', 'Porkbun'],
    [/ui-dns|ionos/, 'ionos', 'IONOS'],
    [/digitalocean\.com/, 'digitalocean', 'DigitalOcean'],
  ];
  for (const [re, id, name] of known) if (re.test(ns)) return { id, name };
  return { id: 'other', name: ns.split(' ')[0].split('.').slice(-2).join('.') };
}
