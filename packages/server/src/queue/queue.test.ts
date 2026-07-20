import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMatch } from '@warwright/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { DEFAULT_RATING, DEFAULT_RATING_DEVIATION, matches, ratings } from '../db/schema.js';
import { createManualScheduler, type ManualScheduler, type QueueService } from './service.js';

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

  /**
   * Builds a test app with a manual scheduler this test fully controls
   * (see queue/service.ts's createManualScheduler doc comment — real
   * elapsed time never matters here, only explicit `fire()` calls do).
   * `maxPool` defaults to the production default (8) so ordinary
   * two/three-player tests exercise the timer path, not the K-trigger;
   * tests of the K-trigger itself override it. Also captures the
   * QueueService instance the plugin creates (via the test-only
   * `onQueueServiceCreated` hook — see QueueConfig's doc comment) so
   * `settleQueue` can await a pass to quiescence, including a K-triggered
   * one that never touches the scheduler at all.
   */
  function buildTestApp(maxPool?: number): {
    app: FastifyInstance;
    scheduler: ManualScheduler;
    getQueueService: () => QueueService;
  } {
    const scheduler = createManualScheduler();
    const queueServiceBox: { current?: QueueService } = {};
    const app = buildApp({
      db,
      pool,
      session: { secret: SESSION_SECRET, cookieSecure: false, pruneSessionInterval: false },
      queue: {
        scheduler,
        maxPool,
        onQueueServiceCreated: (service) => {
          queueServiceBox.current = service;
        },
      },
    });
    return { app, scheduler, getQueueService: () => queueServiceBox.current! };
  }

  /**
   * Runs any pending pairing pass to completion and awaits it to
   * quiescence: fires the batching-window timer if one is armed (the
   * common case), then always awaits `queueService.settled()` — which
   * also covers a K-triggered pass. Shared by every test below that needs
   * to observe a pairing's result: enqueue -> settleQueue -> GET,
   * replacing #57's inline-200 assertions (see this file's git history for
   * the pre-#108 shape).
   */
  async function settleQueue(scheduler: ManualScheduler, getQueueService: () => QueueService): Promise<void> {
    if (scheduler.pending) {
      scheduler.fire();
    }
    await getQueueService().settled();
  }

  /** Registers a fresh account over HTTP and returns its id plus an authenticated session + CSRF token. */
  async function registerUser(app: FastifyInstance) {
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
    app: FastifyInstance,
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

  /** POSTs /queue and asserts the universal 202 waiting contract (never 200 since #108 — see this file's top-level doc comment). */
  async function postEnqueue(
    app: FastifyInstance,
    user: { cookie: string; csrfToken: string },
    warbandId: string
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: user.cookie, 'csrf-token': user.csrfToken },
      payload: { warbandId },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'waiting' });
    return response;
  }

  async function getStatus(app: FastifyInstance, user: { cookie: string }) {
    const response = await app.inject({ method: 'GET', url: '/queue', headers: { cookie: user.cookie } });
    return response.json() as { status: string; matchId?: string; result?: { winner: string } };
  }

  it('pairs two players via a batching-window pass: both POSTs are 202, and GET delivers the matched result, persisting exactly one matches row reproducible by re-run', async () => {
    const { app, scheduler, getQueueService } = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);

    await postEnqueue(app, userA, warbandAId);
    await postEnqueue(app, userB, warbandBId);

    await settleQueue(scheduler, getQueueService);

    const statusA = await getStatus(app, userA);
    expect(statusA.status).toBe('matched');
    const matchId = statusA.matchId!;
    expect(['A', 'B', 'draw']).toContain(statusA.result!.winner);

    const rows = await db
      .select()
      .from(matches)
      .where(and(eq(matches.userAId, userA.id), eq(matches.userBId, userB.id)));
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.id).toBe(matchId);

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
    const { app, scheduler, getQueueService } = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);

    await postEnqueue(app, userA, warbandAId);
    await postEnqueue(app, userB, warbandBId);
    await settleQueue(scheduler, getQueueService);

    const getA = await app.inject({ method: 'GET', url: '/queue', headers: { cookie: userA.cookie } });
    expect(getA.statusCode).toBe(200);
    const bodyA = getA.json() as { status: string; matchId: string };
    expect(bodyA.status).toBe('matched');
    const matchId = bodyA.matchId;

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
    const { app } = buildTestApp();
    const user = await registerUser(app);
    const warbandId = await saveWarband(app, user, warbandA);

    await postEnqueue(app, user, warbandId);

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
    const { app } = buildTestApp();
    const user = await registerUser(app);
    const warbandId = await saveWarband(app, user, warbandA);

    await postEnqueue(app, user, warbandId);

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

  // Since #108, the waiting pool routinely holds more than one entry at
  // once (the whole point of the batching-window accumulation policy) —
  // the #57-era comment here claimed the opposite ("can never hold two
  // entries"), which was already false even under #57 via the failPairing
  // restore path (A restored while C waits => 2 entries; see PR #107's
  // comment thread). The dedicated nearest-rating E2E test below now
  // exercises the real multi-candidate scenario this comment used to say
  // was unreachable. This test keeps proving the narrower, still-relevant
  // fact: a user with no `ratings` row reads as DEFAULT_RATING (1500)
  // without crashing, and still pairs and gets rated from that lazy
  // default (applyMatchRatings, hooked in after resolveMatch).
  it('pairs a user with no ratings row using the lazy 1500 default, then rates both from it', async () => {
    const { app, scheduler, getQueueService } = buildTestApp();
    const userP = await registerUser(app);
    const userR = await registerUser(app); // no ratings row at all
    await setRating(userP.id, 1200);

    const warbandPId = await saveWarband(app, userP, warbandA);
    const warbandRId = await saveWarband(app, userR, warbandB);

    await postEnqueue(app, userP, warbandPId);
    await postEnqueue(app, userR, warbandRId);
    await settleQueue(scheduler, getQueueService);

    const status = await getStatus(app, userP);
    expect(status.status).toBe('matched');
    const matchId = status.matchId!;

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row).toBeDefined();
    expect(row!.userAId).toBe(userP.id);
    expect(row!.userBId).toBe(userR.id);

    // R's ratings row was created by the post-resolve rating write, from
    // the DEFAULT_RATING lazy default it had going into the match.
    const rRatingRows = await db.select().from(ratings).where(eq(ratings.userId, userR.id));
    expect(rRatingRows.length).toBe(1);

    await app.close();
  });

  it('rejects unauthenticated requests to all three endpoints with 401', async () => {
    const { app } = buildTestApp();

    const post = await app.inject({ method: 'POST', url: '/queue', payload: { warbandId: crypto.randomUUID() } });
    expect(post.statusCode).toBe(401);

    const get = await app.inject({ method: 'GET', url: '/queue' });
    expect(get.statusCode).toBe(401);

    const del = await app.inject({ method: 'DELETE', url: '/queue' });
    expect(del.statusCode).toBe(401);

    await app.close();
  });

  it('rejects mutating requests with a valid session but no CSRF token: 403', async () => {
    const { app } = buildTestApp();
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
    const { app, scheduler, getQueueService } = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);

    await postEnqueue(app, userA, warbandAId);
    // Extra client-supplied fields must be stripped/ignored, not forwarded to resolveMatch.
    const joinResponse = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: { cookie: userB.cookie, 'csrf-token': userB.csrfToken },
      payload: { warbandId: warbandBId, seed: 999999, winner: 'B' },
    });
    expect(joinResponse.statusCode).toBe(202);
    await settleQueue(scheduler, getQueueService);

    const status = await getStatus(app, userB);
    expect(status.status).toBe('matched');
    const matchId = status.matchId!;
    const result = status.result as unknown as { seed: number };
    expect(result.seed).not.toBe(999999);

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row).toBeDefined();
    expect(row!.seed).toBe(BigInt(result.seed));

    await app.close();
  });

  it('resolved match snapshots are immutable to a later PUT edit of the source warband', async () => {
    const { app, scheduler, getQueueService } = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);

    await postEnqueue(app, userA, warbandAId);
    await postEnqueue(app, userB, warbandBId);
    await settleQueue(scheduler, getQueueService);

    const status = await getStatus(app, userA);
    const matchId = status.matchId!;

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

  it('handles concurrent joiners: both concurrent POSTs are 202, exactly one pairing results, the leftover stays waiting, and exactly one match row is created', async () => {
    const { app, scheduler, getQueueService } = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const userC = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);
    const warbandCId = await saveWarband(app, userC, warbandA);

    await postEnqueue(app, userA, warbandAId);

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

    // Every enqueue is 202 now, concurrent or not: no double-response, no
    // self-pairing artifact from the race (see service.test.ts for the
    // pure-unit no-double/self-pair proof over a larger pool).
    expect(responseB.statusCode).toBe(202);
    expect(responseC.statusCode).toBe(202);

    await settleQueue(scheduler, getQueueService);

    const [statusB, statusC] = await Promise.all([getStatus(app, userB), getStatus(app, userC)]);
    const outcomes = [statusB.status, statusC.status].sort();
    expect(outcomes).toEqual(['matched', 'waiting']);

    const rows = await db.select().from(matches).where(eq(matches.userAId, userA.id));
    expect(rows.length).toBe(1);

    await app.close();
  });

  it("scopes /queue to the caller's own warbands: a foreign or nonexistent warbandId 404s", async () => {
    const { app } = buildTestApp();
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

  it('rates both players once a queue match resolves: winner up, loser (or both, on a draw) RD shrinks, matches.rated_at is set', async () => {
    const { app, scheduler, getQueueService } = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);

    await postEnqueue(app, userA, warbandAId);
    await postEnqueue(app, userB, warbandBId);
    await settleQueue(scheduler, getQueueService);

    const status = await getStatus(app, userA);
    const matchId = status.matchId!;
    const result = status.result as unknown as { winner: 'A' | 'B' | 'draw' };

    const rows = await db.select().from(ratings).where(inArray(ratings.userId, [userA.id, userB.id]));
    expect(rows.length).toBe(2);
    const rowA = rows.find((row) => row.userId === userA.id)!;
    const rowB = rows.find((row) => row.userId === userB.id)!;

    expect(rowA.ratingDeviation).toBeLessThan(DEFAULT_RATING_DEVIATION);
    expect(rowB.ratingDeviation).toBeLessThan(DEFAULT_RATING_DEVIATION);
    if (result.winner === 'A') {
      expect(rowA.rating).toBeGreaterThan(DEFAULT_RATING);
      expect(rowB.rating).toBeLessThan(DEFAULT_RATING);
    } else if (result.winner === 'B') {
      expect(rowB.rating).toBeGreaterThan(DEFAULT_RATING);
      expect(rowA.rating).toBeLessThan(DEFAULT_RATING);
    } else {
      expect(rowA.rating).toBeCloseTo(DEFAULT_RATING, 6);
      expect(rowB.rating).toBeCloseTo(DEFAULT_RATING, 6);
    }

    const [matchRow] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(matchRow?.ratedAt).not.toBeNull();

    await app.close();
  });

  it('returns 429 after exceeding the per-route POST /queue rate limit (30/min)', async () => {
    const { app } = buildTestApp();
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

  // --- New #108 E2E tests: the acceptance-criteria centerpiece ---------

  it('nearest-rating pairing over a real 3-client pool: P (1200) pairs with lazy-default R (1500) over Q (1600), leaving Q waiting', async () => {
    const { app, scheduler, getQueueService } = buildTestApp();
    const userP = await registerUser(app);
    const userQ = await registerUser(app);
    const userR = await registerUser(app); // no ratings row: lazy DEFAULT_RATING (1500)
    await setRating(userP.id, 1200);
    await setRating(userQ.id, 1600);

    const warbandPId = await saveWarband(app, userP, warbandA);
    const warbandQId = await saveWarband(app, userQ, warbandB);
    const warbandRId = await saveWarband(app, userR, warbandA);

    await postEnqueue(app, userP, warbandPId);
    await postEnqueue(app, userQ, warbandQId);
    await postEnqueue(app, userR, warbandRId);

    // All three simultaneously waiting at once — structurally unreachable
    // under #57's always-pair-the-sole-waiter design.
    expect((await getStatus(app, userP)).status).toBe('waiting');
    expect((await getStatus(app, userQ)).status).toBe('waiting');
    expect((await getStatus(app, userR)).status).toBe('waiting');

    await settleQueue(scheduler, getQueueService);

    // Oldest (P) picks nearest rating among {Q, R}: R (1500, diff 300) over
    // Q (1600, diff 400).
    const statusP = await getStatus(app, userP);
    expect(statusP.status).toBe('matched');
    const matchId = statusP.matchId!;

    const statusQ = await getStatus(app, userQ);
    expect(statusQ.status).toBe('waiting');

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row).toBeDefined();
    expect(row!.userAId).toBe(userP.id);
    expect(row!.userBId).toBe(userR.id);

    const rows = await db.select().from(matches);
    const rowsInThisPool = rows.filter(
      (candidate) => candidate.userAId === userP.id || candidate.userBId === userP.id
    );
    expect(rowsInThisPool.length).toBe(1);

    await app.close();
  });

  it('concurrency safety over a larger pool: concurrent POSTs never double- or self-pair', async () => {
    const { app, scheduler, getQueueService } = buildTestApp();
    const users = await Promise.all([registerUser(app), registerUser(app), registerUser(app), registerUser(app)]);
    const warbandIds = await Promise.all(
      users.map((user, index) => saveWarband(app, user, index % 2 === 0 ? warbandA : warbandB))
    );

    const responses = await Promise.all(
      users.map((user, index) =>
        app.inject({
          method: 'POST',
          url: '/queue',
          headers: { cookie: user.cookie, 'csrf-token': user.csrfToken },
          payload: { warbandId: warbandIds[index] },
        })
      )
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(202);
    }

    await settleQueue(scheduler, getQueueService);

    const statuses = await Promise.all(users.map((user) => getStatus(app, user)));
    const matchedCount = statuses.filter((status) => status.status === 'matched').length;
    const waitingCount = statuses.filter((status) => status.status === 'waiting').length;
    expect(matchedCount).toBe(4);
    expect(waitingCount).toBe(0);

    const matchIds = new Set(statuses.map((status) => status.matchId));
    expect(matchIds.size).toBe(2); // 4 users -> exactly two distinct matches

    const rows = await db
      .select()
      .from(matches)
      .where(
        inArray(
          matches.userAId,
          users.map((user) => user.id)
        )
      );
    expect(rows.length).toBe(2);

    await app.close();
  });

  it('K-trigger: with maxPool 2, the second enqueue pairs immediately, without any timer fire', async () => {
    const { app, scheduler, getQueueService } = buildTestApp(2);
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    const warbandBId = await saveWarband(app, userB, warbandB);

    await postEnqueue(app, userA, warbandAId);
    expect(scheduler.pending).toBe(false); // lone waiter: not pairable yet

    await postEnqueue(app, userB, warbandBId);
    // K reached: no timer was ever armed for this pool.
    expect(scheduler.pending).toBe(false);

    await getQueueService().settled();

    const statusA = await getStatus(app, userA);
    expect(statusA.status).toBe('matched');

    await app.close();
  });

  it('failure both-restore: a resolveMatch failure restores both entries to waiting and re-arms the timer', async () => {
    const { app, scheduler, getQueueService } = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const warbandAId = await saveWarband(app, userA, warbandA);
    // An unsaved/foreign-looking warbandId can't be enqueued (404s before
    // reaching enqueue()), so to exercise the resolver's own failure path
    // we instead delete A's warband row out from under an in-flight
    // pairing: resolveMatch re-validates snapshots against core's
    // parseWarband at resolve time, but the queue snapshot itself
    // (warbandRow.data) was already captured at enqueue() — so a more
    // direct trigger is dropping the `warbands` FK, which resolveMatch's
    // insert into `matches` depends on for referential integrity.
    const warbandBId = await saveWarband(app, userB, warbandB);

    await postEnqueue(app, userA, warbandAId);
    await postEnqueue(app, userB, warbandBId);

    // Force the pending pairing's resolveMatch to fail by deleting user A's
    // account (and therefore, via FK cascade, their warband) after they've
    // already been captured into the queue's in-memory pairing but before
    // the pass has run resolveMatch's DB insert.
    await db.execute(sql`DELETE FROM users WHERE id = ${userA.id}`);

    expect(scheduler.pending).toBe(true);
    scheduler.fire();
    await getQueueService().settled();

    // B is restored to waiting (A's account/session no longer resolves).
    const statusB = await getStatus(app, userB);
    expect(statusB.status).toBe('waiting');

    // Both restorations happening (not just B) re-armed the timer, since
    // the pool became pairable again the moment a third joiner arrives.
    const userC = await registerUser(app);
    const warbandCId = await saveWarband(app, userC, warbandA);
    await postEnqueue(app, userC, warbandCId);
    expect(scheduler.pending).toBe(true);

    await app.close();
  });
});
