import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

const SESSION_SECRET = 'a'.repeat(32);

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!header) throw new Error('expected a Set-Cookie header');
  return header.split(';', 1)[0] ?? '';
}

describe.skipIf(!url)('auth rate limiting', () => {
  let db: Database;
  let pool: Awaited<ReturnType<typeof createDb>>['pool'];

  beforeAll(async () => {
    ({ db, pool } = createDb(url!));
    await runMigrations(url!);
  });

  afterAll(async () => {
    await pool.end();
  });

  function buildTestApp() {
    return buildApp({ db, pool, session: { secret: SESSION_SECRET, cookieSecure: false } });
  }

  it('returns 429 after exceeding the per-route login rate limit', async () => {
    const app = buildTestApp();

    const csrfResponse = await app.inject({ method: 'GET', url: '/auth/csrf' });
    const cookie = extractCookie(csrfResponse.headers['set-cookie']);
    const { csrfToken } = csrfResponse.json() as { csrfToken: string };

    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { cookie, 'csrf-token': csrfToken },
        payload: { email: 'ratelimit-probe@example.com', password: 'wrong password' },
      });

    const statuses: number[] = [];
    // The route's rate limit is 10 requests/minute; the 11th must be 429.
    for (let i = 0; i < 11; i += 1) {
      const response = await attempt();
      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, 10)).toEqual(new Array<number>(10).fill(401));
    expect(statuses[10]).toBe(429);

    await app.close();
  });
});
