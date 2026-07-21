import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { COSMETICS, DEFAULT_COSMETIC_BY_SLOT } from './catalog.js';

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

const SESSION_SECRET = 'a'.repeat(32);
let emailCounter = 0;

function uniqueEmail(): string {
  emailCounter += 1;
  return `cosmetics-test-${Date.now()}-${emailCounter}@example.com`;
}

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!header) throw new Error('expected a Set-Cookie header');
  return header.split(';', 1)[0] ?? '';
}

describe.skipIf(!url)('cosmetics routes', () => {
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

  const nonDefault = COSMETICS.find((c) => !c.defaultOwned)!;
  const otherSlotNonDefault = COSMETICS.find((c) => !c.defaultOwned && c.slot !== nonDefault.slot)!;

  it('rejects all four endpoints without a session cookie: 401', async () => {
    const app = buildTestApp();

    const catalog = await app.inject({ method: 'GET', url: '/cosmetics/catalog' });
    expect(catalog.statusCode).toBe(401);

    const state = await app.inject({ method: 'GET', url: '/cosmetics' });
    expect(state.statusCode).toBe(401);

    const acquire = await app.inject({
      method: 'POST',
      url: '/cosmetics/acquire',
      payload: { cosmeticId: nonDefault.id },
    });
    expect(acquire.statusCode).toBe(401);

    const selection = await app.inject({
      method: 'PUT',
      url: '/cosmetics/selection',
      payload: { slot: nonDefault.slot, cosmeticId: nonDefault.id },
    });
    expect(selection.statusCode).toBe(401);

    await app.close();
  });

  it('rejects mutating routes with a valid session but no CSRF token: 403', async () => {
    const app = buildTestApp();
    const { cookie } = await registerAndAuthenticate(app);

    const acquire = await app.inject({
      method: 'POST',
      url: '/cosmetics/acquire',
      headers: { cookie },
      payload: { cosmeticId: nonDefault.id },
    });
    expect(acquire.statusCode).toBe(403);

    const selection = await app.inject({
      method: 'PUT',
      url: '/cosmetics/selection',
      headers: { cookie },
      payload: { slot: nonDefault.slot, cosmeticId: nonDefault.id },
    });
    expect(selection.statusCode).toBe(403);

    await app.close();
  });

  it('GET /cosmetics/catalog returns the full catalog', async () => {
    const app = buildTestApp();
    const { cookie } = await registerAndAuthenticate(app);

    const response = await app.inject({ method: 'GET', url: '/cosmetics/catalog', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(COSMETICS);

    await app.close();
  });

  it('GET /cosmetics: a fresh account owns exactly the defaultOwned cosmetics and its selection is the catalog default per slot', async () => {
    const app = buildTestApp();
    const { cookie } = await registerAndAuthenticate(app);

    const response = await app.inject({ method: 'GET', url: '/cosmetics', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { owned: string[]; selection: Record<string, string> };

    const expectedOwned = COSMETICS.filter((c) => c.defaultOwned).map((c) => c.id);
    expect(body.owned.sort()).toEqual(expectedOwned.sort());
    expect(body.selection).toEqual(DEFAULT_COSMETIC_BY_SLOT);

    await app.close();
  });

  it('POST /cosmetics/acquire: grants a named cosmetic (idempotent on repeat) and it shows up owned', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    const first = await app.inject({
      method: 'POST',
      url: '/cosmetics/acquire',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { cosmeticId: nonDefault.id },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/cosmetics/acquire',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { cosmeticId: nonDefault.id },
    });
    expect(second.statusCode).toBe(201);

    const state = await app.inject({ method: 'GET', url: '/cosmetics', headers: { cookie } });
    const body = state.json() as { owned: string[] };
    expect(body.owned.filter((id) => id === nonDefault.id)).toHaveLength(1);

    await app.close();
  });

  it('POST /cosmetics/acquire: rejects an unknown cosmeticId with 400', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    const response = await app.inject({
      method: 'POST',
      url: '/cosmetics/acquire',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { cosmeticId: 'not-a-real-cosmetic' },
    });
    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('PUT /cosmetics/selection: selecting a defaultOwned cosmetic requires no prior acquire', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);
    const defaultCosmetic = COSMETICS.find((c) => c.defaultOwned)!;

    const response = await app.inject({
      method: 'PUT',
      url: '/cosmetics/selection',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { slot: defaultCosmetic.slot, cosmeticId: defaultCosmetic.id },
    });
    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('PUT /cosmetics/selection: rejects selecting an unowned, non-default cosmetic with 403', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    const response = await app.inject({
      method: 'PUT',
      url: '/cosmetics/selection',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { slot: nonDefault.slot, cosmeticId: nonDefault.id },
    });
    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it('PUT /cosmetics/selection: rejects an unknown cosmeticId with 400', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    const response = await app.inject({
      method: 'PUT',
      url: '/cosmetics/selection',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { slot: nonDefault.slot, cosmeticId: 'not-a-real-cosmetic' },
    });
    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('PUT /cosmetics/selection: rejects a slot/cosmeticId mismatch with 400', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    // nonDefault belongs to nonDefault.slot, not otherSlotNonDefault.slot.
    const response = await app.inject({
      method: 'PUT',
      url: '/cosmetics/selection',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { slot: otherSlotNonDefault.slot, cosmeticId: nonDefault.id },
    });
    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('acquire then select: an owned cosmetic can be selected and the selection persists in GET /cosmetics', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await registerAndAuthenticate(app);

    const acquire = await app.inject({
      method: 'POST',
      url: '/cosmetics/acquire',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { cosmeticId: nonDefault.id },
    });
    expect(acquire.statusCode).toBe(201);

    const select = await app.inject({
      method: 'PUT',
      url: '/cosmetics/selection',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { slot: nonDefault.slot, cosmeticId: nonDefault.id },
    });
    expect(select.statusCode).toBe(200);

    const state = await app.inject({ method: 'GET', url: '/cosmetics', headers: { cookie } });
    const body = state.json() as { selection: Record<string, string> };
    expect(body.selection[nonDefault.slot]).toBe(nonDefault.id);

    await app.close();
  });

  it('scopes ownership and selection to the owning account: cross-account state never leaks', async () => {
    const app = buildTestApp();
    const userA = await registerAndAuthenticate(app);
    const userB = await registerAndAuthenticate(app);

    const acquireA = await app.inject({
      method: 'POST',
      url: '/cosmetics/acquire',
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: { cosmeticId: nonDefault.id },
    });
    expect(acquireA.statusCode).toBe(201);

    const selectA = await app.inject({
      method: 'PUT',
      url: '/cosmetics/selection',
      headers: { cookie: userA.cookie, 'csrf-token': userA.csrfToken },
      payload: { slot: nonDefault.slot, cosmeticId: nonDefault.id },
    });
    expect(selectA.statusCode).toBe(200);

    const stateB = await app.inject({ method: 'GET', url: '/cosmetics', headers: { cookie: userB.cookie } });
    const bodyB = stateB.json() as { owned: string[]; selection: Record<string, string> };
    expect(bodyB.owned).not.toContain(nonDefault.id);
    expect(bodyB.selection).toEqual(DEFAULT_COSMETIC_BY_SLOT);

    // userB cannot select userA's acquired-but-not-owned-by-B cosmetic either.
    const selectB = await app.inject({
      method: 'PUT',
      url: '/cosmetics/selection',
      headers: { cookie: userB.cookie, 'csrf-token': userB.csrfToken },
      payload: { slot: nonDefault.slot, cosmeticId: nonDefault.id },
    });
    expect(selectB.statusCode).toBe(403);

    await app.close();
  });
});
