// The storefront tracker's events never use up a guest IP's API allowance (menus, orders): a restaurant's guests
// often share one Wi-Fi IP. Production limits, made tiny here.
process.env.NODE_ENV = 'production';
process.env.RATE_LIMIT_MAX_API = '3';
process.env.RATE_LIMIT_MAX_EVENTS = '1000';

describe('rate limits: tracking vs the rest of the API', () => {
  it('lets many tracker posts through without eating the IP\'s API budget', async () => {
    const { default: request } = await import('supertest');
    const { default: app } = await import('../app.js');
    const ip = '203.0.113.7';
    for (let i = 0; i < 20; i++) {
      const r = await request(app).post('/api/v1/public/events').set('X-Forwarded-For', ip).send({});
      expect(r.status).not.toBe(429);
    }
    // the same IP still has its whole (tiny) API budget for real requests
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await request(app).get('/api/v1/auth/tenants/subdomain-check').set('X-Forwarded-For', ip)).status);
    }
    expect(codes.slice(0, 3).every((c) => c !== 429)).toBe(true);
    expect(codes[3]).toBe(429); // …and the general limit itself still works
  }, 30_000);
});
