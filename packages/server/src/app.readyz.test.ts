import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb } from './db/client.js';

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

describe.skipIf(!url)('GET /readyz', () => {
  const { db, pool } = createDb(url ?? '');

  afterAll(async () => {
    await pool.end();
  });

  it('responds 200 { status: "ok" } when SELECT 1 succeeds against a real database', async () => {
    const app = buildApp({ db });

    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });

    await app.close();
  });
});
