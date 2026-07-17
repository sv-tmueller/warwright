import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';

// Test-only session field, exercising request.session.get/set generically.
declare module 'fastify' {
  interface Session {
    count?: number;
  }
}

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

describe.skipIf(!url)('session plugin', () => {
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
    const app = buildApp({
      db,
      pool,
      session: { secret: SESSION_SECRET, cookieSecure: false },
    });

    app.post('/__test/session-count', async (request) => {
      const current = request.session.get('count') ?? 0;
      request.session.set('count', current + 1);
      return { count: current + 1 };
    });

    // app.csrfProtection is attached asynchronously when the session
    // plugin's registration runs during boot, which happens after
    // buildApp() returns here — reference it lazily so the hook sees the
    // decorator once boot has actually completed.
    app.post(
      '/__test/csrf-protected',
      { onRequest: (request, reply, done) => app.csrfProtection(request, reply, done) },
      async () => ({ ok: true })
    );

    app.get('/__test/csrf-token', async (_request, reply) => ({ token: reply.generateCsrf() }));

    return app;
  }

  it('persists session data across requests using the session cookie', async () => {
    const app = buildTestApp();

    const first = await app.inject({ method: 'POST', url: '/__test/session-count' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ count: 1 });
    const cookie = extractCookie(first.headers['set-cookie']);

    const second = await app.inject({
      method: 'POST',
      url: '/__test/session-count',
      headers: { cookie },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ count: 2 });

    await app.close();
  });

  it('rejects a mutating request with no CSRF token', async () => {
    const app = buildTestApp();

    const response = await app.inject({ method: 'POST', url: '/__test/csrf-protected' });

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it('accepts a mutating request carrying a valid CSRF token from the same session', async () => {
    const app = buildTestApp();

    const tokenResponse = await app.inject({ method: 'GET', url: '/__test/csrf-token' });
    const cookie = extractCookie(tokenResponse.headers['set-cookie']);
    const { token } = tokenResponse.json() as { token: string };

    const response = await app.inject({
      method: 'POST',
      url: '/__test/csrf-protected',
      headers: { cookie, 'csrf-token': token },
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });
});
