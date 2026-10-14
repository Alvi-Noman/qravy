// A restaurant's own domain: what the owner types, the records they add, and what the check tells them.
import { checkRecords, detectProvider, parseDomain, recordsFor, setResolverForTests } from '../utils/customDomain.js';

const SERVER = '75.119.152.240';
const TARGET = 'burger-house.qravy.com';

/** Public DNS as a table: name → A / AAAA / CNAME / NS answers. */
function fakeDns(table: Record<string, { a?: string[]; aaaa?: string[]; cname?: string[]; ns?: string[] }>) {
  const get = (k: 'a' | 'aaaa' | 'cname' | 'ns') => async (name: string) => {
    const v = table[name]?.[k];
    if (!v) throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' });
    return v;
  };
  setResolverForTests({ resolve4: get('a'), resolve6: get('aaaa'), resolveCname: get('cname'), resolveNs: get('ns') } as never);
}

describe('parseDomain', () => {
  it('accepts what owners actually type', () => {
    expect(parseDomain('burgerhouse.com')).toMatchObject({ host: 'burgerhouse.com', kind: 'apex', primary: 'burgerhouse.com' });
    expect(parseDomain('https://www.BurgerHouse.com/menu?x=1')).toMatchObject({
      host: 'burgerhouse.com',
      kind: 'apex',
      primary: 'www.burgerhouse.com',
    });
    expect(parseDomain('order.burgerhouse.com')).toMatchObject({ host: 'order.burgerhouse.com', kind: 'sub', zone: 'burgerhouse.com' });
    // a Bangladeshi domain is a whole domain, not a subdomain of com.bd
    expect(parseDomain('kacchibhai.com.bd')).toMatchObject({ host: 'kacchibhai.com.bd', kind: 'apex', zone: 'kacchibhai.com.bd' });
    expect(parseDomain('www.kacchibhai.com.bd')).toMatchObject({ host: 'kacchibhai.com.bd', primary: 'www.kacchibhai.com.bd' });
  });

  it('refuses what is no domain of theirs', () => {
    for (const bad of ['', 'burgerhouse', 'com.bd', '1.2.3.4', 'burger house.com', '-bad.com', 'burger-house.qravy.com', 'qravy.com', 'x.onqravy.com']) {
      expect(parseDomain(bad)).toBeNull();
    }
  });
});

describe('recordsFor', () => {
  it('a whole domain: A for @ and a CNAME for www; a subdomain: one CNAME', () => {
    expect(recordsFor(parseDomain('burgerhouse.com')!, TARGET, [SERVER])).toEqual([
      { type: 'A', name: '@', value: SERVER, host: 'burgerhouse.com' },
      { type: 'CNAME', name: 'www', value: TARGET, host: 'www.burgerhouse.com' },
    ]);
    expect(recordsFor(parseDomain('order.burgerhouse.com')!, TARGET, [SERVER])).toEqual([
      { type: 'CNAME', name: 'order', value: TARGET, host: 'order.burgerhouse.com' },
    ]);
  });
});

describe('checkRecords', () => {
  const recs = recordsFor(parseDomain('burgerhouse.com')!, TARGET, [SERVER]);

  it('all right', async () => {
    fakeDns({ 'burgerhouse.com': { a: [SERVER] }, 'www.burgerhouse.com': { cname: [`${TARGET}.`] } });
    const out = await checkRecords(recs, TARGET, [SERVER]);
    expect(out.map((r) => r.ok)).toEqual([true, true]);
  });

  it('www as an A record to our server is fine too', async () => {
    fakeDns({ 'burgerhouse.com': { a: [SERVER] }, 'www.burgerhouse.com': { a: [SERVER] } });
    expect((await checkRecords(recs, TARGET, [SERVER])).every((r) => r.ok)).toBe(true);
  });

  it('names each problem so the owner knows what to fix', async () => {
    fakeDns({ 'burgerhouse.com': { a: ['34.1.2.3'] } });
    let out = await checkRecords(recs, TARGET, [SERVER]);
    expect(out[0]).toMatchObject({ ok: false, problem: 'wrong', found: ['34.1.2.3'] });
    expect(out[1]).toMatchObject({ ok: false, problem: 'missing' });

    fakeDns({ 'burgerhouse.com': { a: [SERVER, '34.1.2.3'] }, 'www.burgerhouse.com': { cname: [TARGET] } });
    out = await checkRecords(recs, TARGET, [SERVER]);
    expect(out[0]).toMatchObject({ ok: false, problem: 'extra' });

    fakeDns({ 'burgerhouse.com': { a: ['104.21.5.6'] }, 'www.burgerhouse.com': { a: ['172.67.1.2'] } });
    out = await checkRecords(recs, TARGET, [SERVER]);
    expect(out.map((r) => r.problem)).toEqual(['cloudflare-proxy', 'cloudflare-proxy']);

    fakeDns({ 'burgerhouse.com': { a: [SERVER], aaaa: ['2001:db8::1'] }, 'www.burgerhouse.com': { cname: [TARGET] } });
    out = await checkRecords(recs, TARGET, [SERVER]);
    expect(out[0]).toMatchObject({ ok: false, problem: 'ipv6' });
  });
});

describe('detectProvider', () => {
  it('from the name servers', async () => {
    fakeDns({ 'burgerhouse.com': { ns: ['ns51.domaincontrol.com.', 'ns52.domaincontrol.com.'] } });
    expect(await detectProvider('burgerhouse.com')).toEqual({ id: 'godaddy', name: 'GoDaddy' });
    fakeDns({ 'burgerhouse.com': { ns: ['dns1.registrar-servers.com'] } });
    expect((await detectProvider('burgerhouse.com'))?.id).toBe('namecheap');
    fakeDns({ 'burgerhouse.com': { ns: ['ada.ns.cloudflare.com'] } });
    expect((await detectProvider('burgerhouse.com'))?.id).toBe('cloudflare');
    fakeDns({ 'burgerhouse.com': { ns: ['ns1.exonhost.com'] } });
    expect(await detectProvider('burgerhouse.com')).toEqual({ id: 'other', name: 'exonhost.com' });
    fakeDns({});
    expect(await detectProvider('burgerhouse.com')).toBeNull();
  });
});
