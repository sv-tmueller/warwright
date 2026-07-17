import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('buildApp', () => {
  it('responds 200 { status: "ok" } on GET /healthz, DB-free', async () => {
    const app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });

    await app.close();
  });
});
