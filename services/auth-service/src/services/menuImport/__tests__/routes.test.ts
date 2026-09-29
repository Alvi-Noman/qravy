import request from 'supertest';
import app from '../../../app.js';

describe('menu import routes', () => {
  it.each([
    ['post', '/api/v1/menu-imports'],
    ['get', '/api/v1/menu-imports'],
    ['get', '/api/v1/menu-imports/65f000000000000000000001'],
    ['patch', '/api/v1/menu-imports/65f000000000000000000001/draft'],
    ['post', '/api/v1/menu-imports/65f000000000000000000001/commit'],
  ] as const)('%s %s requires auth', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });
});
