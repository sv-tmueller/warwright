import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMatch } from '@warwright/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { matches, ratings } from '../db/schema.js';

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

const SESSION_SECRET = 'a'.repeat(32);
let emailCounter = 0;

function uniqueEmail(): string {
  emailCounter += 1;
  return `queue-test-${Date.now()}-${emailCounter}@example.com`;
}

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!header) throw new Error('expected a Set-Cookie header');
  return header.split(';', 1)[0] ?? '';
}

function loadBuild(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../../../../builds/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

const warbandA = loadBuild('warband-a.json');
const warbandB = loadBuild('warband-b.json');

describe.skipIf(!url)('queue routes', () => {
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

  /** Registers a fresh account over HTTP and returns its id plus an authenticated session + CSRF token. */
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

    const csrfResponse = await app.inject({ method: 'GET', url: '/auth/csrf', headers: { cookie } });
    const { csrfToken } = csrfResponse.json() as { csrfToken: string };

    return { id, cookie, csrfToken };
  }

  /** Saves a warband for an authenticated user and returns its id. */
  async function saveWarband(
    app: ReturnType<typeof buildTestApp>,
    user: { cookie: string; csrfToken: string },
    build: Record<string, unknown>
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie: user.cookie, 'csrf-token': user.csrfToken },
      payload: build,
    });
    const { id } = response.json() as { id: string };
    return id;
  }

  async function setRating(userId: string, rating: number): Promise<void> {
    await db.insert(ratings).values({ userId, rating });
  }

  it('pairs two players: the first getting waiting (202), the second matched (200), and persists exactly one matches row reproducible by re-run', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);

    const first = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: { warbandId: warbandAId },
    });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ status: 'waiting' });

    const second = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userB.cookie, 'csrf-token': userB.csrfToken },
      payload: { warbandId: warbandBId },
    });
    expect(second.statusCode).toBe(200);
    const matched = second.json() as {
      status: string;
      matchId: string;
      result: { version: number; seed: number; hash: number; winner: string; eventLog: unknown[] };
    };
    expect(matched.status).toBe('matched');
    expect(['A', 'B', 'draw']).toContain(matched.result.winner);
    expect(matched.result.eventLog.length).toBeGreaterThan(0);

    const rows = await db
      .select()
      .from(matches)
      .where(and(eq(matches.userAId, userA.id), eq(matches.userBId, userB.id)));
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.id).toBe(matched.matchId);

    const rerun = runMatch({
      version: row.rulesetVersion,
      seed: Number(row.seed),
      buildA: row.buildA,
      buildB: row.buildB,
    });
    expect(BigInt(rerun.hash)).toBe(row.resultHash);
    expect(rerun.winner).toBe(row.winner);

    await app.close();
  });

  it('delivers the same matched result to both clients via GET, and clears it once the winner re-enqueues', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);

    await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: { warbandId: warbandAId },
    });
    const joinResponse = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userB.cookie, 'csrf-token': userB.csrfToken },
      payload: { warbandId: warbandBId },
    });
    const { matchId } = joinResponse.json() as { matchId: string };

    const getA = await app.inject({ method: 'GET', url: '/queue', headers: { cookie: userA.cookie } });
    expect(getA.statusCode).toBe(200);
    expect((getA.json() as { status: string; matchId: string }).status).toBe('matched');
    expect((getA.json() as { status: string; matchId: string }).matchId).toBe(matchId);

    const getB = await app.inject({ method: 'GET', url: '/queue', headers: { cookie: userB.cookie } });
    expect((getB.json() as { status: string; matchId: string }).matchId).toBe(matchId);

    // Retained across repeated GETs, not cleared by reading it.
    const getAAgain = await app.inject({ method: 'GET', url: '/queue', headers: { cookie: userA.cookie } });
    expect((getAAgain.json() as { status: string }).status).toBe('matched');

    // Cleared once A re-enqueues.
    const reEnqueue = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: { warbandId: warbandAId },
    });
    expect(reEnqueue.statusCode).toBe(202);

    await app.close();
  });

  it('a lone waiter can leave the queue: waiting -> DELETE 204 -> idle', async () => {
    const app = buildTestApp();
    const user = await registerUser(app);
    const warbandId = await saveWarband(app, user, warbandA);

    const enqueue = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: user.cookie, 'csrf-token': user.csrfToken },
      payload: { warbandId },
    });
    expect(enqueue.statusCode).toBe(202);

    const status = await app.inject({ method: 'GET', url: '/queue', headers: { cookie: user.cookie } });
    expect(status.json()).toEqual({ status: 'waiting' });

    const del = await app.inject({
      method: 'DELETE',
      url: '/queue',
      headers: { cookie: user.cookie, 'csrf-token': user.csrfToken },
    });
    expect(del.statusCode).toBe(204);

    const afterDelete = await app.inject({ method: 'GET', url: '/queue', headers: { cookie: user.cookie } });
    expect(afterDelete.json()).toEqual({ status: 'idle' });

    const secondDelete = await app.inject({
      method: 'DELETE',
      url: '/queue',
      headers: { cookie: user.cookie, 'csrf-token': user.csrfToken },
    });
    expect(secondDelete.statusCode).toBe(404);

    await app.close();
  });

  it('never self-pairs: a second POST from the same waiting user is 409', async () => {
    const app = buildTestApp();
    const user = await registerUser(app);
    const warbandId = await saveWarband(app, user, warbandA);

    const first = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: user.cookie, 'csrf-token': user.csrfToken },
      payload: { warbandId },
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: user.cookie, 'csrf-token': user.csrfToken },
      payload: { warbandId },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'Already queued' });

    await app.close();
  });

  // With the always-pair-the-sole-available-candidate semantics (see
  // service.ts's no-await invariant: enqueue() is atomic and pairs
  // immediately whenever any candidate is waiting), the `waiting` pool can
  // never hold two entries at once — the moment a second distinct user
  // enqueues, they always find the one existing waiter and pair with them.
  // So a true "nearest of several simultaneously-waiting candidates" choice
  // is only observable at the unit level (service.test.ts, which drives
  // selectOpponent directly against a synthetic multi-candidate pool,
  // including the P=1200/Q=1600/joiner=1500 example from the #57 sub-plan).
  // This integration test instead proves the DB-backed half of decision 3:
  // a user with no `ratings` row reads as DEFAULT_RATING (1500) without
  // crashing or inserting a row, and still pairs successfully.
  it('pairs a user with no ratings row using the lazy 1500 default, without inserting a ratings row', async () => {
    const app = buildTestApp();
    const userP = await registerUser(app);
    const userR = await registerUser(app); // no ratings row at all
    await setRating(userP.id, 1200);

    const warbandPId = await saveWarband(app, userP, warbandA);
    const warbandRId = await saveWarband(app, userR, warbandB);

    const waitResponse = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userP.cookie, 'csrf-token': userP.csrfToken },
      payload: { warbandId: warbandPId },
    });
    expect(waitResponse.statusCode).toBe(202);

    const joinResponse = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userR.cookie, 'csrf-token': userR.csrfToken },
      payload: { warbandId: warbandRId },
    });
    expect(joinResponse.statusCode).toBe(200);
    const { matchId } = joinResponse.json() as { matchId: string };

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row).toBeDefined();
    expect(row!.userAId).toBe(userP.id);
    expect(row!.userBId).toBe(userR.id);

    // Reading R's (lazy-default) rating must not have inserted a row.
    const rRatingRows = await db.select().from(ratings).where(eq(ratings.userId, userR.id));
    expect(rRatingRows.length).toBe(0);

    await app.close();
  });

  it('rejects unauthenticated requests to all three endpoints with 401', async () => {
    const app = buildTestApp();

    const post = await app.inject({ method: 'POST', url: '/queue', payload: { warbandId: crypto.randomUUID() } });
    expect(post.statusCode).toBe(401);

    const get = await app.inject({ method: 'GET', url: '/queue' });
    expect(get.statusCode).toBe(401);

    const del = await app.inject({ method: 'DELETE', url: '/queue' });
    expect(del.statusCode).toBe(401);

    await app.close();
  });

  it('rejects mutating requests with a valid session but no CSRF token: 403', async () => {
    const app = buildTestApp();
    const user = await registerUser(app);

    const post = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: user.cookie },
      payload: { warbandId: crypto.randomUUID() },
    });
    expect(post.statusCode).toBe(403);

    const del = await app.inject({ method: 'DELETE', url: '/queue', headers: { cookie: user.cookie } });
    expect(del.statusCode).toBe(403);

    await app.close();
  });

  it('accepts only intent (warbandId): a client-supplied seed/winner is ignored, proven by a server-computed re-run', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);

    await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: { warbandId: warbandAId },
    });
    const joinResponse = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userB.cookie, 'csrf-token': userB.csrfToken },
      // Extra client-supplied fields must be stripped/ignored, not forwarded to resolveMatch.
      payload: { warbandId: warbandBId, seed: 999999, winner: 'B' },
    });
    expect(joinResponse.statusCode).toBe(200);
    const { matchId, result } = joinResponse.json() as { matchId: string; result: { seed: number } };
    expect(result.seed).not.toBe(999999);

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row).toBeDefined();
    expect(row!.seed).toBe(BigInt(result.seed));

    await app.close();
  });

  it('resolved match snapshots are immutable to a later PUT edit of the source warband', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);

    await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: { warbandId: warbandAId },
    });
    const joinResponse = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userB.cookie, 'csrf-token': userB.csrfToken },
      payload: { warbandId: warbandBId },
    });
    const { matchId } = joinResponse.json() as { matchId: string };

    const editedBuild = { ...warbandA, name: 'Edited After Queueing' };
    const putResponse = await app.inject({
      method: 'PUT',
      url: `/warbands/${warbandAId}`,
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: editedBuild,
    });
    expect(putResponse.statusCode).toBe(200);

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row).toBeDefined();
    expect(row!.buildA).toEqual(warbandA);
    expect(row!.buildA).not.toEqual(editedBuild);

    await app.close();
  });

  it('handles concurrent joiners: exactly one pairs, the other stays waiting, and exactly one match row is created', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const userC = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);
    const warbandCId = await saveWarband(app, userC, warbandA);

    await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: { warbandId: warbandAId },
    });

    const [responseB, responseC] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/queue',
        headers: { cookie: userB.cookie, 'csrf-token': userB.csrfToken },
        payload: { warbandId: warbandBId },
      }),
      app.inject({
        method: 'POST',
        url: '/queue',
        headers: { cookie: userC.cookie, 'csrf-token': userC.csrfToken },
        payload: { warbandId: warbandCId },
      }),
    ]);

    const statuses = [responseB.statusCode, responseC.statusCode].sort();
    expect(statuses).toEqual([200, 202]);

    const rows = await db.select().from(matches).where(eq(matches.userAId, userA.id));
    expect(rows.length).toBe(1);

    await app.close();
  });

  it('scopes /queue to the caller\'s own warbands: a foreign or nonexistent warbandId 404s', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);

    const foreign = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userB.cookie, 'csrf-token': userB.csrfToken },
      payload: { warbandId: warbandAId },
    });
    expect(foreign.statusCode).toBe(404);

    const nonexistent = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: { warbandId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(nonexistent.statusCode).toBe(404);

    await app.close();
  });

  it('returns 429 after exceeding the per-route POST /queue rate limit (30/min)', async () => {
    const app = buildTestApp();
    const user = await registerUser(app);

    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/queue',
        headers: { cookie: user.cookie, 'csrf-token': user.csrfToken },
        // A nonexistent warbandId still counts against the rate limit (the
        // limiter runs before the handler's own 404 lookup) and avoids
        // running 31 real sim resolutions just to probe the limiter.
        payload: { warbandId: '00000000-0000-0000-0000-000000000000' },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      const response = await attempt();
      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, 30)).toEqual(new Array<number>(30).fill(404));
    expect(statuses[30]).toBe(429);

    await app.close();
  });
});
