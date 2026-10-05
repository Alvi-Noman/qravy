import request from 'supertest';
import app from '../../../app.js';

describe('quick demo routes (public)', () => {
  it('starting a demo needs no login, only a menu', async () => {
    const res = await request(app).post('/api/v1/public/quick-demo');
    // 400 "attach a menu" — or 503 on a server without an OpenAI key; never 401
    expect([400, 503]).toContain(res.status);
  });

  it.each([
    ['get', '/api/v1/public/quick-demo/not-a-key'],
    ['post', '/api/v1/public/quick-demo/not-a-key/name'],
  ] as const)('%s %s with a malformed key is 404', async (method, path) => {
    const res = await request(app)[method](path).send({ name: 'Test' });
    expect(res.status).toBe(404);
  });
});
