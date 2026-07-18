import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { ratings, users } from '../db/schema.js';

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

const SESSION_SECRET = 'a'.repeat(32);
let emailCounter = 0;

function uniqueEmail(): string {
  emailCounter += 1;
  return `leaderboard-test-${Date.now()}-${emailCounter}@example.com`;
}

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!header) throw new Error('expected a Set-Cookie header');
  return header.split(';', 1)[0] ?? '';
}

describe.skipIf(!url)('GET /leaderboard', () => {
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
    return buildApp({
      db,
      pool,
      session: { secret: SESSION_SECRET, cookieSecure: false, pruneSessionInterval: false },
    });
  }

  /** Registers a fresh account and returns its id plus an authenticated session cookie. */
  async function registerUser(app: ReturnType<typeof buildTestApp>) {
    const preCsrf = await app.inject({ method: 'GET', url: '/auth/csrf' });
    const preCookie = extractCookie(preCsrf.headers['set-cookie']);
    const { csrfToken: preToken } = preCsrf.json() as { csrfToken: string };

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie: preCookie, 'csrf-token': preToken },
      payload: { email: uniqueEmail(), password: 'correct horse battery staple' },
    });
    const { id } = registerResponse.json() as { id: string };
    const cookie = extractCookie(registerResponse.headers['set-cookie']);
    return { id, cookie };
  }

  async function makeUserWithRating(rating: number): Promise<string> {
    const [user] = await db.insert(users).values({ email: uniqueEmail(), passwordHash: 'hash' }).returning();
    if (!user) throw new Error('user insert returned no row');
    await db.insert(ratings).values({ userId: user.id, rating });
    return user.id;
  }

  it('rejects an unauthenticated request: 401', async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/leaderboard' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('orders by rating descending, tie-breaking on user id ascending, and never returns email', async () => {
    const app = buildTestApp();
    const viewer = await registerUser(app);

    // Ratings are set far above DEFAULT_RATING (1500) so these fixtures stay
    // at the very top of the leaderboard no matter how many ~1500-rated rows
    // the rest of the suite (e.g. queue pairing tests) has already written to
    // this shared, never-truncated test database. Combined with ?limit=100
    // below, this keeps the assertion on relative order deterministic instead
    // of depending on file/test execution order.
    const lowId = await makeUserWithRating(1_000_400);
    const highId = await makeUserWithRating(1_000_800);
    const midId = await makeUserWithRating(1_000_600);

    const response = await app.inject({
      method: 'GET',
      url: '/leaderboard?limit=100',
      headers: { cookie: viewer.cookie },
    });
    expect(response.statusCode).toBe(200);

    const body = response.json() as Array<Record<string, unknown>>;
    const relevant = body.filter((row) => [lowId, highId, midId].includes(row.userId as string));
    expect(relevant.map((row) => row.userId)).toEqual([highId, midId, lowId]);

    for (const row of body) {
      expect(row).not.toHaveProperty('email');
      expect(Object.keys(row).sort()).toEqual(['rating', 'ratingDeviation', 'updatedAt', 'userId']);
    }
    await app.close();
  });

  it('defaults to a limit of 20 and honors a supplied ?limit=, capped at 100', async () => {
    const app = buildTestApp();
    const viewer = await registerUser(app);
    for (let i = 0; i < 25; i += 1) {
      await makeUserWithRating(1000 + i);
    }

    const defaultResponse = await app.inject({
      method: 'GET',
      url: '/leaderboard',
      headers: { cookie: viewer.cookie },
    });
    expect((defaultResponse.json() as unknown[]).length).toBeLessThanOrEqual(20);

    const limitedResponse = await app.inject({
      method: 'GET',
      url: '/leaderboard?limit=3',
      headers: { cookie: viewer.cookie },
    });
    expect((limitedResponse.json() as unknown[]).length).toBe(3);

    // Out-of-range external input fails loud (400), rather than being
    // silently clamped — same "validate and fail loud" convention as every
    // other Zod-validated request input in this codebase.
    const overLimit = await app.inject({
      method: 'GET',
      url: '/leaderboard?limit=1000',
      headers: { cookie: viewer.cookie },
    });
    expect(overLimit.statusCode).toBe(400);

    const atCap = await app.inject({
      method: 'GET',
      url: '/leaderboard?limit=100',
      headers: { cookie: viewer.cookie },
    });
    expect(atCap.statusCode).toBe(200);

    await app.close();
  });
});
