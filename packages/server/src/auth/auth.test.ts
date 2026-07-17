import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { users } from '../db/schema.js';

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

const SESSION_SECRET = 'a'.repeat(32);
let emailCounter = 0;

function uniqueEmail(): string {
  emailCounter += 1;
  return `auth-test-${Date.now()}-${emailCounter}@example.com`;
}

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!header) throw new Error('expected a Set-Cookie header');
  return header.split(';', 1)[0] ?? '';
}

describe.skipIf(!url)('auth routes', () => {
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

  /** GETs a fresh CSRF token and returns it with the session cookie it was issued on. */
  async function getCsrfToken(app: ReturnType<typeof buildTestApp>) {
    const response = await app.inject({ method: 'GET', url: '/auth/csrf' });
    const cookie = extractCookie(response.headers['set-cookie']);
    const { csrfToken } = response.json() as { csrfToken: string };
    return { cookie, csrfToken };
  }

  it('registers a new user: 201, session cookie set, session authenticated', async () => {
    const app = buildTestApp();
    const email = uniqueEmail();
    const { cookie, csrfToken } = await getCsrfToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { email, password: 'correct horse battery staple' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; email: string };
    expect(body.email).toBe(email);
    expect(typeof body.id).toBe('string');
    const sessionCookie = extractCookie(response.headers['set-cookie']);

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: sessionCookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ id: body.id, email });

    await app.close();
  });

  it('rejects duplicate registration (case-varied email) with 409', async () => {
    const app = buildTestApp();
    const email = uniqueEmail();
    const password = 'correct horse battery staple';

    const first = await getCsrfToken(app);
    const firstResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie: first.cookie, 'csrf-token': first.csrfToken },
      payload: { email, password },
    });
    expect(firstResponse.statusCode).toBe(201);

    const second = await getCsrfToken(app);
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie: second.cookie, 'csrf-token': second.csrfToken },
      payload: { email: email.toUpperCase(), password },
    });
    expect(secondResponse.statusCode).toBe(409);

    await app.close();
  });

  it('stores an argon2id hash, never the plaintext password', async () => {
    const app = buildTestApp();
    const email = uniqueEmail();
    const password = 'correct horse battery staple';
    const { cookie, csrfToken } = await getCsrfToken(app);

    await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { email, password },
    });

    const [row] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
    expect(row).toBeDefined();
    expect(row!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row!.passwordHash).not.toContain(password);

    await app.close();
  });

  it('logs in with correct credentials: 200, new session id (fixation protection)', async () => {
    const app = buildTestApp();
    const email = uniqueEmail();
    const password = 'correct horse battery staple';

    const register = await getCsrfToken(app);
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie: register.cookie, 'csrf-token': register.csrfToken },
      payload: { email, password },
    });
    const registerSessionCookie = extractCookie(registerResponse.headers['set-cookie']);

    // Use the same (now-authenticated) session to fetch a CSRF token for login.
    const loginCsrf = await app.inject({
      method: 'GET',
      url: '/auth/csrf',
      headers: { cookie: registerSessionCookie },
    });
    const { csrfToken: loginToken } = loginCsrf.json() as { csrfToken: string };

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { cookie: registerSessionCookie, 'csrf-token': loginToken },
      payload: { email, password },
    });

    expect(loginResponse.statusCode).toBe(200);
    const loginSessionCookie = extractCookie(loginResponse.headers['set-cookie']);
    expect(loginSessionCookie).not.toBe(registerSessionCookie);

    await app.close();
  });

  it('rejects login with the wrong password: 401 with a generic body', async () => {
    const app = buildTestApp();
    const email = uniqueEmail();
    const password = 'correct horse battery staple';

    const register = await getCsrfToken(app);
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie: register.cookie, 'csrf-token': register.csrfToken },
      payload: { email, password },
    });

    const { cookie, csrfToken } = await getCsrfToken(app);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { email, password: 'totally wrong password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid credentials' });

    await app.close();
  });

  it('rejects login with an unknown email: 401 with the identical generic body', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await getCsrfToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { email: uniqueEmail(), password: 'whatever password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid credentials' });

    await app.close();
  });

  it('logs out: destroys the session server-side so the old cookie no longer authenticates', async () => {
    const app = buildTestApp();
    const email = uniqueEmail();
    const password = 'correct horse battery staple';

    const register = await getCsrfToken(app);
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie: register.cookie, 'csrf-token': register.csrfToken },
      payload: { email, password },
    });
    const sessionCookie = extractCookie(registerResponse.headers['set-cookie']);

    const meBefore = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: sessionCookie },
    });
    expect(meBefore.statusCode).toBe(200);

    const csrf = await app.inject({
      method: 'GET',
      url: '/auth/csrf',
      headers: { cookie: sessionCookie },
    });
    const { csrfToken } = csrf.json() as { csrfToken: string };

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: sessionCookie, 'csrf-token': csrfToken },
    });
    expect(logoutResponse.statusCode).toBe(200);

    const meAfter = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: sessionCookie },
    });
    expect(meAfter.statusCode).toBe(401);

    await app.close();
  });

  it('GET /auth/me without a session returns 401', async () => {
    const app = buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('rejects a mutating auth route with no CSRF token: 403', async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: uniqueEmail(), password: 'correct horse battery staple' },
    });

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it('GET routes are unaffected by CSRF protection', async () => {
    const app = buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(response.statusCode).not.toBe(403);

    await app.close();
  });

  it('rejects a malformed email with 400', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await getCsrfToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { email: 'not-an-email', password: 'correct horse battery staple' },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('rejects a short password with 400', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await getCsrfToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { email: uniqueEmail(), password: 'short' },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('rejects a missing password with 400', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await getCsrfToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie, 'csrf-token': csrfToken },
      payload: { email: uniqueEmail() },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('login kills the pre-login session id server-side (fixation): replaying it 401s', async () => {
    const app = buildTestApp();
    const email = uniqueEmail();
    const password = 'correct horse battery staple';

    // Establish a pre-auth session, then have it become authenticated via
    // register (mirrors the tester's repro: a fixated session id that later
    // logs in). The pre-login cookie is the one register's response set.
    const register = await getCsrfToken(app);
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie: register.cookie, 'csrf-token': register.csrfToken },
      payload: { email, password },
    });
    const preLoginCookie = extractCookie(registerResponse.headers['set-cookie']);

    // Sanity: the pre-login cookie is authenticated before login rotates it.
    const meBeforeLogin = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: preLoginCookie },
    });
    expect(meBeforeLogin.statusCode).toBe(200);

    const loginCsrf = await app.inject({
      method: 'GET',
      url: '/auth/csrf',
      headers: { cookie: preLoginCookie },
    });
    const { csrfToken: loginToken } = loginCsrf.json() as { csrfToken: string };

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { cookie: preLoginCookie, 'csrf-token': loginToken },
      payload: { email, password },
    });
    expect(loginResponse.statusCode).toBe(200);
    const postLoginCookie = extractCookie(loginResponse.headers['set-cookie']);
    expect(postLoginCookie).not.toBe(preLoginCookie);

    // The pre-login session id must be dead server-side: replaying it must
    // not authenticate (checking only that the cookie VALUE changed is
    // insufficient — that passed while the old id stayed live in the store).
    const replayPreLogin = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: preLoginCookie },
    });
    expect(replayPreLogin.statusCode).toBe(401);

    // The new, post-login session must still work.
    const meAfterLogin = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: postLoginCookie },
    });
    expect(meAfterLogin.statusCode).toBe(200);

    await app.close();
  });

  it('register kills the pre-register session id server-side (fixation): replaying it 401s', async () => {
    const app = buildTestApp();
    const email = uniqueEmail();
    const password = 'correct horse battery staple';

    // A "planted" pre-auth cookie, as an attacker would set on a victim's
    // browser before the victim registers.
    const plant = await app.inject({ method: 'GET', url: '/healthz' });
    const plantedCookie = extractCookie(plant.headers['set-cookie']);

    const csrf = await app.inject({
      method: 'GET',
      url: '/auth/csrf',
      headers: { cookie: plantedCookie },
    });
    const { csrfToken } = csrf.json() as { csrfToken: string };

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie: plantedCookie, 'csrf-token': csrfToken },
      payload: { email, password },
    });
    expect(registerResponse.statusCode).toBe(201);
    const postRegisterCookie = extractCookie(registerResponse.headers['set-cookie']);
    expect(postRegisterCookie).not.toBe(plantedCookie);

    // The planted, pre-register session id must be dead server-side:
    // replaying it must not authenticate as the newly-registered user.
    const replayPlanted = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: plantedCookie },
    });
    expect(replayPlanted.statusCode).toBe(401);

    const meAfterRegister = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: postRegisterCookie },
    });
    expect(meAfterRegister.statusCode).toBe(200);

    await app.close();
  });

  it('rejects a request body over the body limit with 413', async () => {
    const app = buildTestApp();
    const { cookie, csrfToken } = await getCsrfToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { cookie, 'csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: uniqueEmail(),
        password: 'correct horse battery staple',
        padding: 'x'.repeat(70 * 1024),
      }),
    });

    expect(response.statusCode).toBe(413);

    await app.close();
  });
});
