import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWarband, runMatch, RULESET_VERSION } from '@warwright/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { matches } from '../db/schema.js';
import { resolveMatch } from './resolve.js';

// Cross-surface parity (see CLAUDE.md): for a fixed seed and the same
// builds, the CLI, the browser client, and the server must produce the same
// winner and the same event-log hash.
//
// packages/web/src/match-parity.test.ts already pins core == client ==
// CLI-construction for this same seed and these same sample builds. This
// file adds the server leg and asserts server == core; because the web test
// guarantees core == client == CLI, server == core transitively closes
// server == client == CLI, without importing anything from packages/web
// into packages/server (a server<-web dependency would be architecturally
// wrong — see CLAUDE.md's layout rules for packages/web and packages/server).
//
// If this parity assertion ever fails, the fix is to the diverging surface,
// never to weaken or delete this test (CLAUDE.md: "the parity test must
// pass; if it fails, a surface diverged and must be fixed, not the test").
const SEED = 42;

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

const SESSION_SECRET = 'a'.repeat(32);
let emailCounter = 0;

function uniqueEmail(): string {
  emailCounter += 1;
  return `parity-test-${Date.now()}-${emailCounter}@example.com`;
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

describe.skipIf(!url)('cross-surface match parity: server', () => {
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

  async function bumpRulesetVersion(matchId: string): Promise<void> {
    await db.execute(sql`UPDATE matches SET ruleset_version = ${RULESET_VERSION + 1} WHERE id = ${matchId}`);
  }

  it('produces the same winner and hash as the core reference leg for seed 42', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);

    // Server leg: the real server resolution path (resolveMatch), not a
    // direct runMatch call.
    const { matchId } = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: warbandA,
      buildB: warbandB,
      seed: SEED,
    });

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row).toBeDefined();

    // Core reference leg: same seed and same sample builds, driven straight
    // through the public core API.
    const coreLeg = runMatch({
      version: RULESET_VERSION,
      seed: SEED,
      buildA: parseWarband(warbandA),
      buildB: parseWarband(warbandB),
    });

    expect(row!.winner).toBe(coreLeg.winner);
    expect(BigInt(coreLeg.hash)).toBe(row!.resultHash);

    await app.close();
  });

  it('GET /matches/:id/verify: re-runs a stored match under its recorded version and confirms the hash (200 verified:true)', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);

    const { matchId, result } = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: warbandA,
      buildB: warbandB,
      seed: SEED,
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

  it('GET /matches/:id/verify: refuses a cross-ruleset-version comparison with 409, never silently comparing', async () => {
    const app = buildTestApp();
    const userA = await registerUser(app);
    const userB = await registerUser(app);

    const { matchId } = await resolveMatch(db, {
      userAId: userA.id,
      userBId: userB.id,
      buildA: warbandA,
      buildB: warbandB,
      seed: SEED,
    });
    await bumpRulesetVersion(matchId);

    const response = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}/verify`,
      headers: { cookie: userA.cookie },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'cannot verify across ruleset versions',
      storedVersion: RULESET_VERSION + 1,
      currentVersion: RULESET_VERSION,
    });

    await app.close();
  });
});
