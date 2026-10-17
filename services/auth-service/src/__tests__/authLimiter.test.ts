// Rate limits (production limits, made tiny here):
// - login emails per email address (one person's retries never block colleagues on the same Wi-Fi), opening a link
//   isn't counted; guessing limits count only FAILED attempts per IP + account
// - the general API per signed-in USER, per IP only for guests — the example env's 100 / 15 min per IP for the whole
//   API locked an office out of the dashboard and its login
process.env.NODE_ENV = 'production';
process.env.RATE_LIMIT_MAX_AUTH = '3';
process.env.RATE_LIMIT_MAX_CORTEX_FAILS = '3';
process.env.RATE_LIMIT_MAX_CODE_FAILS = '3';
process.env.RATE_LIMIT_MAX_API_IP = '40';
process.env.RATE_LIMIT_MAX_API_USER = '1000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

describe('rate limits', () => {
  afterAll(async () => {
    // the magic-link requests create placeholder users — don't leave them behind
    const { client } = await import('../db.js');
    await client.db('authDB').collection('users').deleteMany({ email: /^(s0|s1|x|guess)@example\.com$/ }).catch(() => undefined);
  });

  it('gives each kind of login its own budget, per account', async () => {
    const { default: request } = await import('supertest');
    const { default: app } = await import('../app.js');
    const ip = '198.51.100.23';
    const cortex = (login: string) =>
      request(app).post('/api/v1/cortex/login').set('X-Forwarded-For', ip).send({ login, password: 'wrong' });
    const email = (to: string) => request(app).post('/api/v1/auth/magic-link').set('X-Forwarded-For', ip).send({ email: to });

    // login emails: per address — the 4th to the same address is refused, another address still goes
    for (let i = 0; i < 3; i++) await email('s0@example.com');
    const fourth = await email('s0@example.com');
    expect(fourth.status).toBe(429);
    expect(fourth.body.message).toMatch(/try again in \d+ minute/);
    expect((await email('s1@example.com')).status).not.toBe(429);
    // opening a link isn't "sending", and Cortex has its own budget
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

  it('limits the API per signed-in user — guests on one Wi-Fi never use up a dashboard user\'s budget', async () => {
    const { default: request } = await import('supertest');
    const { default: app } = await import('../app.js');
    const jwt = (await import('jsonwebtoken')).default;
    const ip = '203.0.113.99';
    const guest = () => request(app).get('/api/v1/public/tenant').set('X-Forwarded-For', ip);
    for (let i = 0; i < 40; i++) expect((await guest()).status).not.toBe(429);
    expect((await guest()).status).toBe(429); // guests: per IP
    // someone signed in, on that same Wi-Fi: their own budget
    const tok = jwt.sign({ id: '0123456789abcdef01234567', email: 'staff@example.com' }, process.env.JWT_SECRET as string, { expiresIn: '5m' });
    const r = await request(app).get('/api/v1/auth/me').set('X-Forwarded-For', ip).set('Authorization', `Bearer ${tok}`);
    expect(r.status).not.toBe(429);
  }, 60_000);
});
