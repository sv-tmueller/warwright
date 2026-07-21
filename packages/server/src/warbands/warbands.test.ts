import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWarband } from '@warwright/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

const SESSION_SECRET = 'a'.repeat(32);
let emailCounter = 0;

function uniqueEmail(): string {
  emailCounter += 1;
  return `warband-test-${Date.now()}-${emailCounter}@example.com`;
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

// The echoed/stored body is the PARSED (Zod-validated) warband, not the raw
// fixture: WarbandSchema defaults each unit's augmentIds to [] (see core's
// UnitBuildSchema), so the response/row carries that field even though the
// raw fixture predates it.
function withDefaultAugmentIds(build: Record<string, unknown>): Record<string, unknown> {
  const units = (build as { units: Array<Record<string, unknown>> }).units;
  return { ...build, units: units.map((unit) => ({ ...unit, augmentIds: [] })) };
}

describe.skipIf(!url)('warband routes', () => {
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

  /** Registers a fresh account and returns an authenticated session cookie plus a valid CSRF token for it. */
  async function registerAndAuthenticate(app: ReturnType<typeof buildTestApp>) {
    const preCsrf = await app.inject({ method: 'GET', url: '/auth/csrf' });
    const preCookie = extractCookie(preCsrf.headers['set-cookie']);
    const { csrfToken: preToken } = preCsrf.json() as { csrfToken: string };

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie: preCookie, 'csrf-token': preToken },
      payload: { email: uniqueEmail(), password: 'correct horse battery staple' },
    });
    const cookie = extractCookie(registerResponse.headers['set-cookie']);

    const csrfResponse = await app.inject({ method: 'GET', url: '/auth/csrf', headers: { cookie } });
    const { csrfToken } = csrfResponse.json() as { csrfToken: string };

    return { cookie, csrfToken };
  }

  it('rejects all five endpoints without a session cookie: 401', async () => {
    const app = buildTestApp();

    const list = await app.inject({ method: 'GET', url: '/warbands' });
    expect(list.statusCode).toBe(401);

    const create = await app.inject({ method: 'POST', url: '/warbands', payload: warbandA });
    expect(create.statusCode).toBe(401);

    const get = await app.inject({ method: 'GET', url: '/warbands/00000000-0000-0000-0000-000000000000' });
    expect(get.statusCode).toBe(401);

    const put = await app.inject({
      method: 'PUT',
      url: '/warbands/00000000-0000-0000-0000-000000000000',
      payload: warbandA,
    });
    expect(put.statusCode).toBe(401);

    const del = await app.inject({
      method: 'DELETE',
      url: '/warbands/00000000-0000-0000-0000-000000000000',
    });
    expect(del.statusCode).toBe(401);

    await app.close();
  });

  it('rejects mutating routes with a valid session but no CSRF token: 403', async () => {
    const app = buildTestApp();
    const { cookie } = await registerAndAuthenticate(app);

    const create = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie },
      payload: warbandA,
    });
    expect(create.statusCode).toBe(403);

    const put = await app.inject({
      method: 'PUT',
      url: '/warbands/00000000-0000-0000-0000-000000000000',
      headers: { cookie },
      payload: warbandA,
    });
    expect(put.statusCode).toBe(403);

    const del = await app.inject({
      method: 'DELETE',
      url: '/warbands/00000000-0000-0000-0000-000000000000',
      headers: { cookie },
    });
    expect(del.statusCode).toBe(403);

    await app.close();
  });

  it('runs the full CRUD lifecycle for one user', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: warbandA,
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      data: unknown;
    };
    expect(created.name).toBe('Iron Vanguard');
    expect(created.data).toEqual(withDefaultAugmentIds(warbandA));

    const listResponse = await app.inject({
      method: 'GET',
      url: '/warbands',
      headers: { cookie },
    });
    expect(listResponse.statusCode).toBe(200);
    const list = listResponse.json() as Array<{ id: string; data?: unknown }>;
    expect(list.some((item) => item.id === created.id)).toBe(true);
    expect(list.every((item) => item.data === undefined)).toBe(true);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/warbands/${created.id}`,
      headers: { cookie },
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual(created);

    const updatedBuild = { ...withDefaultAugmentIds(warbandA), name: 'Iron Vanguard II' };
    // Captured on the same (Node) clock the PUT handler's `new Date()` uses,
    // so this comparison never crosses into Postgres's clock domain (which
    // can visibly skew from the host/container clock and made a
    // created-vs-updated cross-clock comparison here flaky).
    const beforeUpdate = Date.now();
    const putResponse = await app.inject({
      method: 'PUT',
      url: `/warbands/${created.id}`,
      headers: { cookie, 'csrf-token': csrfToken },
      payload: updatedBuild,
    });
    expect(putResponse.statusCode).toBe(200);
    const updated = putResponse.json() as { name: string; updatedAt: string; data: unknown };
    expect(updated.name).toBe('Iron Vanguard II');
    expect(updated.data).toEqual(updatedBuild);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(beforeUpdate);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/warbands/${created.id}`,
      headers: { cookie, 'csrf-token': csrfToken },
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(deleteResponse.body).toBe('');

    const afterDelete = await app.inject({
      method: 'GET',
      url: `/warbands/${created.id}`,
      headers: { cookie },
    });
    expect(afterDelete.statusCode).toBe(404);

    await app.close();
  });

  it('round-trips a non-empty augmentIds array intact through POST -> GET -> PUT -> GET (Slice E, #151)', async () => {
    // augmentIds entries are opaque ids at the schema level (AugmentIdSchema
    // is z.string().min(1)); core only resolves them against its registry at
    // match-time (sim/init.ts), and the registry is empty until Slice D
    // (#150) lands. The warbands routes never resolve augment ids against
    // the registry (findUnknownContentId in routes.ts checks only roleId,
    // skillId, behaviorId) -- so this fixture id need not be registered for
    // the write path to accept and round-trip it.
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    const withAugments = {
      ...warbandA,
      units: (warbandA as { units: Array<Record<string, unknown>> }).units.map((unit, index) =>
        index === 0 ? { ...unit, augmentIds: ['iron-plating', 'iron-plating'] } : unit
      ),
    };

    const createResponse = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: withAugments,
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { id: string; data: { units: Array<{ augmentIds: string[] }> } };
    expect(created.data.units[0]?.augmentIds).toEqual(['iron-plating', 'iron-plating']);
    expect(created.data.units[1]?.augmentIds).toEqual([]);

    const getAfterCreate = await app.inject({
      method: 'GET',
      url: `/warbands/${created.id}`,
      headers: { cookie },
    });
    expect(getAfterCreate.statusCode).toBe(200);
    const fetchedAfterCreate = getAfterCreate.json() as { data: { units: Array<{ augmentIds: string[] }> } };
    expect(fetchedAfterCreate.data.units[0]?.augmentIds).toEqual(['iron-plating', 'iron-plating']);

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/warbands/${created.id}`,
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { ...withAugments, name: 'Iron Vanguard III' },
    });
    expect(putResponse.statusCode).toBe(200);
    const updated = putResponse.json() as { data: { units: Array<{ augmentIds: string[] }> } };
    expect(updated.data.units[0]?.augmentIds).toEqual(['iron-plating', 'iron-plating']);
    expect(updated.data.units[1]?.augmentIds).toEqual([]);

    const getAfterUpdate = await app.inject({
      method: 'GET',
      url: `/warbands/${created.id}`,
      headers: { cookie },
    });
    expect(getAfterUpdate.statusCode).toBe(200);
    const fetchedAfterUpdate = getAfterUpdate.json() as { data: { units: Array<{ augmentIds: string[] }> } };
    expect(fetchedAfterUpdate.data.units[0]?.augmentIds).toEqual(['iron-plating', 'iron-plating']);
    expect(fetchedAfterUpdate.data.units[1]?.augmentIds).toEqual([]);

    await app.close();
  });

  it('scopes access to the owning account: cross-account GET/PUT/DELETE all 404, list excludes foreign rows', async () => {
    const app = buildTestApp();
    const userA = await registerAndAuthenticate(app);
    const userB = await registerAndAuthenticate(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: warbandA,
    });
    const aWarband = createResponse.json() as { id: string; updatedAt: string };

    const bGet = await app.inject({
      method: 'GET',
      url: `/warbands/${aWarband.id}`,
      headers: { cookie: userB.cookie },
    });
    expect(bGet.statusCode).toBe(404);

    const bPut = await app.inject({
      method: 'PUT',
      url: `/warbands/${aWarband.id}`,
      headers: { cookie: userB.cookie, 'csrf-token': userB.csrfToken },
      payload: warbandB,
    });
    expect(bPut.statusCode).toBe(404);

    const bDelete = await app.inject({
      method: 'DELETE',
      url: `/warbands/${aWarband.id}`,
      headers: { cookie: userB.cookie, 'csrf-token': userB.csrfToken },
    });
    expect(bDelete.statusCode).toBe(404);

    const bList = await app.inject({ method: 'GET', url: '/warbands', headers: { cookie: userB.cookie } });
    const bItems = bList.json() as Array<{ id: string }>;
    expect(bItems.some((item) => item.id === aWarband.id)).toBe(false);

    const aGetAfter = await app.inject({
      method: 'GET',
      url: `/warbands/${aWarband.id}`,
      headers: { cookie: userA.cookie },
    });
    expect(aGetAfter.statusCode).toBe(200);
    const aWarbandAfter = aGetAfter.json() as { updatedAt: string; data: unknown };
    expect(aWarbandAfter.updatedAt).toBe(aWarband.updatedAt);
    expect(aWarbandAfter.data).toEqual(withDefaultAugmentIds(warbandA));

    await app.close();
  });

  it('rejects an illegal build (empty units, out-of-arena position, unknown extra key) with 400', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    const emptyUnits = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { name: 'Empty', units: [] },
    });
    expect(emptyUnits.statusCode).toBe(400);

    const outOfArena = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: {
        name: 'Out of bounds',
        units: [
          {
            roleId: 'vanguard',
            skillIds: ['shield-bash'],
            behaviorId: 'protect-allies',
            position: { x: -1, y: 400 },
          },
        ],
      },
    });
    expect(outOfArena.statusCode).toBe(400);

    const unknownKey = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { ...warbandA, extraField: 'not allowed' },
    });
    expect(unknownKey.statusCode).toBe(400);

    await app.close();
  });

  it('rejects a build with an unknown roleId, skillId, or behaviorId with 400 naming the id', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    const unknownRole = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: {
        name: 'Bad role',
        units: [
          {
            roleId: 'not-a-real-role',
            skillIds: [],
            behaviorId: 'protect-allies',
            position: { x: 100, y: 400 },
          },
        ],
      },
    });
    expect(unknownRole.statusCode).toBe(400);
    expect((unknownRole.json() as { error: string }).error).toContain('not-a-real-role');

    const unknownSkill = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: {
        name: 'Bad skill',
        units: [
          {
            roleId: 'vanguard',
            skillIds: ['not-a-real-skill'],
            behaviorId: 'protect-allies',
            position: { x: 100, y: 400 },
          },
        ],
      },
    });
    expect(unknownSkill.statusCode).toBe(400);
    expect((unknownSkill.json() as { error: string }).error).toContain('not-a-real-skill');

    const unknownBehavior = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: {
        name: 'Bad behavior',
        units: [
          {
            roleId: 'vanguard',
            skillIds: [],
            behaviorId: 'not-a-real-behavior',
            position: { x: 100, y: 400 },
          },
        ],
      },
    });
    expect(unknownBehavior.statusCode).toBe(400);
    expect((unknownBehavior.json() as { error: string }).error).toContain('not-a-real-behavior');

    await app.close();
  });

  it('round-trips a stored warband byte-for-structurally-equal through create and read', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: warbandA,
    });
    const created = createResponse.json() as { id: string; data: unknown };

    const getResponse = await app.inject({
      method: 'GET',
      url: `/warbands/${created.id}`,
      headers: { cookie },
    });
    const fetched = getResponse.json() as { data: unknown };

    expect(fetched.data).toEqual(withDefaultAugmentIds(warbandA));
    expect(parseWarband(fetched.data)).toEqual(parseWarband(warbandA));

    await app.close();
  });

  it('rejects a request body over the body limit with 413', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    const response = await app.inject({
      method: 'POST',
      url: '/warbands',
      headers: { cookie, 'csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({ ...warbandA, padding: 'x'.repeat(70 * 1024) }),
    });

    expect(response.statusCode).toBe(413);

    await app.close();
  });

  it('rejects a malformed uuid in the id param with 400', async () => {
    const app = buildTestApp();
    const { cookie } = await registerAndAuthenticate(app);

    const response = await app.inject({
      method: 'GET',
      url: '/warbands/not-a-uuid',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
