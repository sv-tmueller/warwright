import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMatch, RULESET_VERSION } from '@warwright/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { resolveMatch } from './resolve.js';

// runMatch is spied (not stubbed — importOriginal keeps the real
// implementation) so the version-refusal tests below can prove the 409
// path never re-runs the sim, per #111 sub-plan's D5 risk: "the version
// refusal MUST precede the re-run." resolveMatch (used to set up every
// fixture in this file) also goes through this same spied runMatch, so
// each test that asserts non-invocation clears the mock's call history
// right after fixture setup, before hitting the route under test.
vi.mock('@warwright/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@warwright/core')>();
  return { ...actual, runMatch: vi.fn(actual.runMatch) };
});

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

const SESSION_SECRET = 'a'.repeat(32);
let emailCounter = 0;

function uniqueEmail(): string {
  emailCounter += 1;
  return `matches-test-${Date.now()}-${emailCounter}@example.com`;
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

describe.skipIf(!url)('match routes', () => {
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

  /** Registers a fresh account over HTTP and returns its id plus an authenticated session cookie. */
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

  async function tamperResultHash(matchId: string): Promise<void> {
    await db.execute(sql`UPDATE matches SET result_hash = result_hash + 1 WHERE id = ${matchId}`);
  }

  async function bumpRulesetVersion(matchId: string): Promise<void> {
    await db.execute(sql`UPDATE matches SET ruleset_version = ${RULESET_VERSION + 1} WHERE id = ${matchId}`);
  }

  it('GET /matches: newest first, participant-scoped, correct side/opponent', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const userC = await registerUser(app);

    const match1 = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: warbandA,
      buildB: warbandB,
      seed: 101,
    });
    const match2 = await resolveMatch(db, {
      userAId: userB.id,
      userBId: userA.id,
      buildA: warbandB,
      buildB: warbandA,
      seed: 102,
    });
    // Not involving A: proves participant scoping, not just row presence.
    await resolveMatch(db, { userAId: userB.id, userBId: userC.id, buildA: warbandB, buildB: warbandA, seed: 103 });

    const response = await app.inject({ method: 'GET', url: '/matches', headers: { cookie: userA.cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Array<{
      id: string;
      rulesetVersion: number;
      seed: number;
      side: 'A' | 'B';
      opponentUserId: string;
      winner: string;
      resultHash: number;
      createdAt: string;
    }>;

    expect(body.length).toBe(2);
    // newest first
    expect(body[0]!.id).toBe(match2.matchId);
    expect(body[1]!.id).toBe(match1.matchId);

    expect(body[0]!.side).toBe('B');
    expect(body[0]!.opponentUserId).toBe(userB.id);
    expect(body[0]!.rulesetVersion).toBe(RULESET_VERSION);
    expect(body[0]!.seed).toBe(102);
    expect(body[0]!.resultHash).toBe(match2.result.hash);
    expect(body[0]!.winner).toBe(match2.result.winner);

    expect(body[1]!.side).toBe('A');
    expect(body[1]!.opponentUserId).toBe(userB.id);
    expect(body[1]!.seed).toBe(101);
    expect(body[1]!.resultHash).toBe(match1.result.hash);

    await app.close();
  });

  it('GET /matches: rejects unauthenticated requests with 401', async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/matches' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('GET /matches: rejects an over-max ?limit= with 400, like /leaderboard', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);

    const response = await app.inject({
      method: 'GET',
      url: '/matches?limit=1000',
      headers: { cookie: userA.cookie },
    });
    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('GET /matches/:id/replay: 200, result deep-equals the original resolveMatch result', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);

    const { matchId, result } = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: warbandA,
      buildB: warbandB,
      seed: 201,
    });
    vi.mocked(runMatch).mockClear();

    const response = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}/replay`,
      headers: { cookie: userA.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { matchId: string; result: typeof result };
    expect(body.matchId).toBe(matchId);
    expect(body.result).toEqual(result);
    expect(body.result.winner).toBe(result.winner);
    expect(BigInt(body.result.hash)).toBe(BigInt(result.hash));
    expect(runMatch).toHaveBeenCalledTimes(1);

    // The other participant can replay it too.
    const responseB = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}/replay`,
      headers: { cookie: userB.cookie },
    });
    expect(responseB.statusCode).toBe(200);

    await app.close();
  });

  it('GET /matches/:id/verify: green path returns verified:true with matching hashes', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);

    const { matchId, result } = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: warbandA,
      buildB: warbandB,
      seed: 202,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}/verify`,
      headers: { cookie: userA.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      verified: true,
      rulesetVersion: RULESET_VERSION,
      storedHash: result.hash,
      recomputedHash: result.hash,
    });

    await app.close();
  });

  it('GET /matches/:id/verify: a tampered result_hash returns 200 verified:false', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);

    const { matchId, result } = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: warbandA,
      buildB: warbandB,
      seed: 203,
    });
    await tamperResultHash(matchId);

    const response = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}/verify`,
      headers: { cookie: userA.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      verified: boolean;
      rulesetVersion: number;
      storedHash: number;
      recomputedHash: number;
    };
    expect(body.verified).toBe(false);
    expect(body.recomputedHash).toBe(result.hash);
    expect(body.storedHash).not.toBe(result.hash);

    await app.close();
  });

  it('GET /matches/:id/replay: a tampered result_hash under a matching ruleset version 500s (fail loud)', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);

    const { matchId } = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: warbandA,
      buildB: warbandB,
      seed: 207,
    });
    await tamperResultHash(matchId);
    vi.mocked(runMatch).mockClear();

    const response = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}/replay`,
      headers: { cookie: userA.cookie },
    });
    expect(response.statusCode).toBe(500);
    // Proves the 500 came from the post-re-run hash-mismatch check (the
    // version gate passed, since ruleset_version was left untouched), not
    // from the version gate itself.
    expect(runMatch).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('GET /matches/:id/verify and /replay: a bumped ruleset_version 409s on both, refusing BEFORE any re-run', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);

    const { matchId } = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: warbandA,
      buildB: warbandB,
      seed: 204,
    });
    await bumpRulesetVersion(matchId);
    vi.mocked(runMatch).mockClear();

    const verifyResponse = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}/verify`,
      headers: { cookie: userA.cookie },
    });
    expect(verifyResponse.statusCode).toBe(409);
    expect(verifyResponse.json()).toEqual({
      error: 'cannot verify across ruleset versions',
      storedVersion: RULESET_VERSION + 1,
      currentVersion: RULESET_VERSION,
    });

    const replayResponse = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}/replay`,
      headers: { cookie: userA.cookie },
    });
    expect(replayResponse.statusCode).toBe(409);
    expect(replayResponse.json()).toEqual({
      error: 'cannot verify across ruleset versions',
      storedVersion: RULESET_VERSION + 1,
      currentVersion: RULESET_VERSION,
    });

    // The load-bearing assertion: neither 409 re-ran the sim.
    expect(runMatch).not.toHaveBeenCalled();

    await app.close();
  });

  it('GET /matches/:id/replay and /verify: reject unauthenticated requests with 401', async () => {
    const app = buildTestApp();
    const someId = '00000000-0000-0000-0000-000000000000';

    const replay = await app.inject({ method: 'GET', url: `/matches/${someId}/replay` });
    expect(replay.statusCode).toBe(401);

    const verify = await app.inject({ method: 'GET', url: `/matches/${someId}/verify` });
    expect(verify.statusCode).toBe(401);

    await app.close();
  });

  it('GET /matches/:id/replay and /verify: a foreign or nonexistent match id 404s', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const outsider = await registerUser(app);

    const { matchId } = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: warbandA,
      buildB: warbandB,
      seed: 205,
    });

    const foreignReplay = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}/replay`,
      headers: { cookie: outsider.cookie },
    });
    expect(foreignReplay.statusCode).toBe(404);

    const foreignVerify = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}/verify`,
      headers: { cookie: outsider.cookie },
    });
    expect(foreignVerify.statusCode).toBe(404);

    const nonexistentId = '00000000-0000-0000-0000-000000000000';
    const nonexistentReplay = await app.inject({
      method: 'GET',
      url: `/matches/${nonexistentId}/replay`,
      headers: { cookie: userA.cookie },
    });
    expect(nonexistentReplay.statusCode).toBe(404);

    const nonexistentVerify = await app.inject({
      method: 'GET',
      url: `/matches/${nonexistentId}/verify`,
      headers: { cookie: userA.cookie },
    });
    expect(nonexistentVerify.statusCode).toBe(404);

    await app.close();
  });

  it('returns 429 after exceeding the replay/verify rate limit', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);

    const { matchId } = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: warbandA,
      buildB: warbandB,
      seed: 206,
    });

    const attempt = () =>
      app.inject({
        method: 'GET',
        url: `/matches/${matchId}/replay`,
        headers: { cookie: userA.cookie },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      const response = await attempt();
      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, 30)).toEqual(new Array<number>(30).fill(200));
    expect(statuses[30]).toBe(429);

    await app.close();
  });
});
