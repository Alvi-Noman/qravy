// Storefront session recordings (routes/replayRoutes): a chunk every few seconds per guest must not use up a guest
// IP's API allowance (menus, orders — a restaurant's guests share one Wi-Fi IP), and a page's first snapshot is
// bigger than the default 100kb JSON limit. Production limits, made tiny here.
process.env.NODE_ENV = 'production';
process.env.RATE_LIMIT_MAX_API = '3';
process.env.RATE_LIMIT_MAX_EVENTS = '1000';

describe('session recordings: POST /public/replay', () => {
  it('takes a big chunk, and many chunks without eating the IP\'s API budget', async () => {
    const { default: request } = await import('supertest');
    const { default: app } = await import('../app.js');
    const ip = '203.0.113.9';

    // ~600kb of page snapshot: past express's default 100kb, inside the gateway's 2mb
    const big = JSON.stringify([{ type: 2, timestamp: Date.now(), data: { html: 'x'.repeat(600_000) } }]);
    const r = await request(app)
      .post('/api/v1/public/replay')
      .set('X-Forwarded-For', ip)
      .send({ sub: 'nobody-here', did: 'd1', vid: 'v1', seq: 0, enc: 'json', data: big });
    expect(r.status).toBe(204);

    for (let i = 0; i < 20; i++) {
      const c = await request(app).post('/api/v1/public/replay').set('X-Forwarded-For', ip).send({});
      expect(c.status).not.toBe(429);
    }
    // the same IP still has its whole (tiny) API budget for real requests
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await request(app).get('/api/v1/auth/tenants/subdomain-check').set('X-Forwarded-For', ip)).status);
    }
    expect(codes.slice(0, 3).every((c) => c !== 429)).toBe(true);
    expect(codes[3]).toBe(429);
  }, 30_000);
});
