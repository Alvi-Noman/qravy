// Login rate limits (production limits, made tiny here): each risky endpoint has its own budget, guessing limits count
// only FAILED attempts per IP + account, and opening an email link isn't counted. They used to share one per-IP budget
// that also counted successes — a restaurant's staff logging in on one Wi-Fi locked the Cortex sign-in out.
process.env.NODE_ENV = 'production';
process.env.RATE_LIMIT_MAX_AUTH = '3';
process.env.RATE_LIMIT_MAX_CORTEX_FAILS = '3';
process.env.RATE_LIMIT_MAX_CODE_FAILS = '3';

describe('rate limits: logins', () => {
  afterAll(async () => {
    // the magic-link requests create placeholder users — don't leave them behind
    const { client } = await import('../db.js');
    await client.db('authDB').collection('users').deleteMany({ email: /^(s[0-2]|x|guess)@example\.com$/ }).catch(() => undefined);
  });

  it('gives each kind of login its own budget, per account for guessing', async () => {
    const { default: request } = await import('supertest');
    const { default: app } = await import('../app.js');
    const ip = '198.51.100.23';
    const cortex = (login: string) =>
      request(app).post('/api/v1/cortex/login').set('X-Forwarded-For', ip).send({ login, password: 'wrong' });

    // sending login emails uses up this network's sending budget…
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/v1/auth/magic-link').set('X-Forwarded-For', ip).send({ email: `s${i}@example.com` });
    }
    const fourth = await request(app).post('/api/v1/auth/magic-link').set('X-Forwarded-For', ip).send({ email: 'x@example.com' });
    expect(fourth.status).toBe(429);
    expect(fourth.body.message).toMatch(/try again in \d+ minute/);
    // …but opening a link isn't "sending", and Cortex has its own budget
    expect((await request(app).get('/api/v1/auth/magic-link/verify?token=x').set('X-Forwarded-For', ip)).status).not.toBe(429);
    expect((await cortex('owner@qravy.test')).status).not.toBe(429);

    // Cortex: failed attempts per account — the 4th failure for this login is refused, another login still may try
    await cortex('owner@qravy.test');
    await cortex('owner@qravy.test');
    const locked = await cortex('owner@qravy.test');
    expect(locked.status).toBe(429);
    expect(locked.body.message).toMatch(/failed sign-in attempts/);
    expect((await cortex('someone-else@qravy.test')).status).not.toBe(429);

    // the 5-digit email code: wrong guesses are limited too (there was no limit)
    const code = () =>
      request(app).post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip).send({ email: 'guess@example.com', code: '00000' });
    for (let i = 0; i < 3; i++) expect((await code()).status).not.toBe(429);
    expect((await code()).status).toBe(429);
  }, 60_000);
});
