import request from 'supertest';
import app from '../app';

describe('API Gateway', () => {
  it('should return 200 and status "ok" for health check', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});