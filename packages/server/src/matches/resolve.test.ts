import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMatch, RULESET_VERSION } from '@warwright/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { matches } from '../db/schema.js';
import { resolveMatch } from './resolve.js';

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

const SESSION_SECRET = 'a'.repeat(32);
let emailCounter = 0;

function uniqueEmail(): string {
  emailCounter += 1;
  return `resolve-test-${Date.now()}-${emailCounter}@example.com`;
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

describe.skipIf(!url)('resolveMatch', () => {
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

  /** Registers a fresh account over HTTP and returns its user id plus an authenticated session + CSRF token. */
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

  /** Registers two fresh accounts and returns just their ids, for tests that only need resolveMatch's FK inputs. */
  async function twoUserIds(app: ReturnType<typeof buildTestApp>): Promise<{ userAId: string; userBId: string }> {
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    return { userAId: userA.id, userBId: userB.id };
  }

  it('resolves a match: persists a matches row and returns the full MatchResult', async () => {
    const app = buildTestApp();
    const { userAId, userBId } = await twoUserIds(app);

    const { matchId, result } = await resolveMatch(db, {
      userAId,
      userBId,
      buildA: warbandA,
      buildB: warbandB,
      seed: 42,
    });

    expect(result.version).toBe(RULESET_VERSION);
    expect(result.seed).toBe(42);
    expect(['A', 'B', 'draw']).toContain(result.winner);
    expect(typeof result.hash).toBe('number');
    expect(Array.isArray(result.eventLog)).toBe(true);
    expect(result.eventLog.length).toBeGreaterThan(0);

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row).toBeDefined();
    expect(row!.rulesetVersion).toBe(RULESET_VERSION);
    expect(row!.seed).toBe(42n);
    expect(row!.userAId).toBe(userAId);
    expect(row!.userBId).toBe(userBId);
    expect(row!.winner).toBe(result.winner);
    expect(row!.resultHash).toBe(BigInt(result.hash));
    expect(row!.buildA).toEqual(warbandA);
    expect(row!.buildB).toEqual(warbandB);

    await app.close();
  });

  it('reproduces the exact persisted resultHash and winner from a fresh re-run (no drift)', async () => {
    const app = buildTestApp();
    const { userAId, userBId } = await twoUserIds(app);

    const { matchId } = await resolveMatch(db, {
      userAId,
      userBId,
      buildA: warbandA,
      buildB: warbandB,
      seed: 7,
    });

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row).toBeDefined();

    const rerun = runMatch({
      version: row!.rulesetVersion,
      seed: Number(row!.seed),
      buildA: row!.buildA,
      buildB: row!.buildB,
    });

    expect(BigInt(rerun.hash)).toBe(row!.resultHash);
    expect(rerun.winner).toBe(row!.winner);

    await app.close();
  });

  it('snapshots are immutable to later edits of the source warband', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: warbandA,
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { id: string; data: unknown };

    const { matchId } = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: created.data,
      buildB: warbandB,
      seed: 11,
    });

    const editedBuild = { ...warbandA, name: 'Edited After Resolution' };
    const putResponse = await app.inject({
      method: 'PUT',
      url: `/warbands/${created.id}`,
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

  it('chooses a server-side seed in [0, 2^32) when none is supplied', async () => {
    const app = buildTestApp();
    const { userAId, userBId } = await twoUserIds(app);

    const { matchId, result } = await resolveMatch(db, {
      userAId,
      userBId,
      buildA: warbandA,
      buildB: warbandB,
    });

    expect(Number.isInteger(result.seed)).toBe(true);
    expect(result.seed).toBeGreaterThanOrEqual(0);
    expect(result.seed).toBeLessThan(2 ** 32);

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row).toBeDefined();
    expect(row!.seed).toBe(BigInt(result.seed));

    await app.close();
  });

  it('fails loud on an invalid build and persists nothing', async () => {
    const app = buildTestApp();
    const { userAId, userBId } = await twoUserIds(app);

    const countBefore = await db
      .select()
      .from(matches)
      .where(and(eq(matches.userAId, userAId), eq(matches.userBId, userBId)));

    await expect(
      resolveMatch(db, {
        userAId,
        userBId,
        buildA: { name: 'Empty', units: [] },
        buildB: warbandB,
        seed: 1,
      })
    ).rejects.toThrow();

    const countAfter = await db
      .select()
      .from(matches)
      .where(and(eq(matches.userAId, userAId), eq(matches.userBId, userBId)));
    expect(countAfter.length).toBe(countBefore.length);

    await app.close();
  });

  it('fails loud on an out-of-range or non-integer seed and persists nothing', async () => {
    const app = buildTestApp();
    const { userAId, userBId } = await twoUserIds(app);

    const countBefore = await db
      .select()
      .from(matches)
      .where(and(eq(matches.userAId, userAId), eq(matches.userBId, userBId)));

    await expect(
      resolveMatch(db, { userAId, userBId, buildA: warbandA, buildB: warbandB, seed: 2 ** 32 })
    ).rejects.toThrow();

    await expect(
      resolveMatch(db, { userAId, userBId, buildA: warbandA, buildB: warbandB, seed: -1 })
    ).rejects.toThrow();

    await expect(
      resolveMatch(db, { userAId, userBId, buildA: warbandA, buildB: warbandB, seed: 1.5 })
    ).rejects.toThrow();

    const countAfter = await db
      .select()
      .from(matches)
      .where(and(eq(matches.userAId, userAId), eq(matches.userBId, userBId)));
    expect(countAfter.length).toBe(countBefore.length);

    await app.close();
  });
});
