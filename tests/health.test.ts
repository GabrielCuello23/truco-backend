import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';

describe('health endpoints', () => {
  const app = createApp({
    database: {} as never,
    redis: { ping: async () => 'PONG' },
    pingDatabase: async () => undefined,
  });

  it('reports liveness without external dependencies', async () => {
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('reports readiness when dependencies are available', async () => {
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});
