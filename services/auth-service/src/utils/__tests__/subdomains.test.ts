import { checkSubdomain, subdomainCandidates } from '../subdomains.js';

/** Just enough of a tenants collection: these subdomains are taken. */
function tenantsWith(...taken: string[]) {
  const has = (s: string) => taken.includes(s);
  return {
    findOne: async (q: { subdomain: string }) => (has(q.subdomain) ? { _id: q.subdomain } : null),
    find: (q: { subdomain: { $in: string[] } }) => ({
      toArray: async () => q.subdomain.$in.filter(has).map((subdomain) => ({ subdomain })),
    }),
  } as never;
}

describe('subdomain check (sign-up)', () => {
  it('says a free one is free', async () => {
    expect(await checkSubdomain(tenantsWith('burger-house'), 'pizza-place')).toEqual({
      subdomain: 'pizza-place',
      available: true,
      suggestions: [],
    });
  });

  it('offers free ones close to a taken one', async () => {
    const r = await checkSubdomain(tenantsWith('burger-house', 'burger-house-bd'), 'Burger-House');
    expect(r).toMatchObject({ subdomain: 'burger-house', available: false, reason: 'taken' });
    expect(r.suggestions).toEqual(['the-burger-house', 'burger-house-restaurant', 'burger-house-kitchen']);
  });

  it('turns away our own names', async () => {
    const r = await checkSubdomain(tenantsWith(), 'app');
    expect(r).toMatchObject({ available: false, reason: 'reserved' });
    expect(r.suggestions.length).toBe(3);
  });

  it('does not look up a malformed one', async () => {
    expect(await checkSubdomain(tenantsWith(), '-bad--')).toMatchObject({ available: false, reason: 'invalid' });
  });

  it('keeps every suggestion valid, even for a long name', () => {
    for (const s of subdomainCandidates('a-very-long-restaurant-name-here-x')) {
      expect(s).toMatch(/^[a-z0-9](?:[a-z0-9]|-(?!-)){1,30}[a-z0-9]$/);
      expect(s.length).toBeLessThanOrEqual(32);
    }
  });
});

describe('subdomain check route', () => {
  it('needs a signed-in user', async () => {
    const { default: request } = await import('supertest');
    const { default: app } = await import('../../app.js');
    const res = await request(app).get('/api/v1/auth/tenants/subdomain-check?subdomain=burger-house');
    expect(res.status).toBe(401);
  });
});
