import fastifyRateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from './password.js';

declare module 'fastify' {
  interface Session {
    userId?: string;
  }
}

export interface AuthRoutesOptions {
  db: Database;
}

const CredentialsBodySchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(128),
});

// Applied to /auth/register and /auth/login: brute-force/credential-stuffing
// throttling. The in-memory store (the plugin's default) is per-process,
// fine for a single server instance; a shared store is a later concern.
const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

const GENERIC_INVALID_CREDENTIALS = { error: 'Invalid credentials' } as const;
const GENERIC_NOT_AUTHENTICATED = { error: 'Not authenticated' } as const;

// A dummy password checked when the looked-up email doesn't exist, so an
// unknown-email login takes roughly as long as a wrong-password one (closes
// the user-enumeration timing side-channel). Computed once and cached.
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('warwright-dummy-password-for-timing-parity');
  return dummyHashPromise;
}

// The Postgres unique_violation SQLSTATE. drizzle-orm's node-postgres driver
// wraps the underlying `pg` error (which carries `.code`) in `.cause`.
const PG_UNIQUE_VIOLATION = '23505';

function hasCode(value: unknown, code: string): boolean {
  return typeof value === 'object' && value !== null && 'code' in value && value.code === code;
}

function isUniqueViolation(error: unknown): boolean {
  if (hasCode(error, PG_UNIQUE_VIOLATION)) return true;
  const cause = error instanceof Error ? error.cause : undefined;
  return hasCode(cause, PG_UNIQUE_VIOLATION);
}

/**
 * Rotates the session id, closing the session-fixation hole at both
 * privilege-escalation points (login and register).
 *
 * `@fastify/session@11.1.2`'s `session.regenerate()` only issues a new
 * session id; it does NOT destroy the old id's row in the store, so a
 * pre-auth (or attacker-planted) session id stays fully authenticated after
 * regenerate() alone. Captures the pre-regenerate id and explicitly destroys
 * it in the store afterward so the old id is dead server-side, not just
 * superseded client-side by a changed cookie value.
 */
async function rotateSession(request: FastifyRequest): Promise<void> {
  const oldSessionId = request.session.sessionId;
  await request.session.regenerate();
  if (oldSessionId && oldSessionId !== request.session.sessionId) {
    const destroy = promisify(request.sessionStore.destroy.bind(request.sessionStore));
    await destroy(oldSessionId);
  }
}

/**
 * Registers the /auth/* routes (register, login, logout, me, csrf). Must be
 * registered after the session plugin (src/plugins/session.ts) has attached
 * request.session, app.csrfProtection, and reply.generateCsrf; see
 * src/app.ts's registration order.
 */
const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, options) => {
  const { db } = options;

  // global: false — rate limiting only applies to routes that opt in via
  // { config: { rateLimit: ... } }, not to every route on the app.
  await app.register(fastifyRateLimit, { global: false });

  // app.csrfProtection is attached by the session plugin's own (deferred,
  // asynchronous) registration; referencing it lazily inside the hook
  // wrapper, rather than capturing app.csrfProtection at registration time,
  // ensures the hook sees the real decorator once boot has completed.
  const csrfProtection: preHandlerHookHandler = (request, reply, done) =>
    app.csrfProtection(request, reply, done);

  app.get('/auth/csrf', async (_request, reply) => ({ csrfToken: reply.generateCsrf() }));

  app.post(
    '/auth/register',
    {
      onRequest: csrfProtection,
      schema: { body: CredentialsBodySchema },
      config: { rateLimit: AUTH_RATE_LIMIT },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const passwordHash = await hashPassword(password);

      try {
        const [user] = await db.insert(users).values({ email, passwordHash }).returning();
        if (!user) throw new Error('user insert returned no row');

        // Rotate the session id on register too: registering must kill any
        // pre-auth (or attacker-planted) session id, not just the one set
        // on login. See rotateSession's doc comment.
        await rotateSession(request);
        request.session.set('userId', user.id);
        await request.session.save();

        reply.code(201);
        return { id: user.id, email: user.email };
      } catch (error) {
        if (isUniqueViolation(error)) {
          reply.code(409);
          return { error: 'Email already registered' };
        }
        throw error;
      }
    }
  );

  app.post(
    '/auth/login',
    {
      onRequest: csrfProtection,
      schema: { body: CredentialsBodySchema },
      config: { rateLimit: AUTH_RATE_LIMIT },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const [user] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${email.toLowerCase()}`);

      if (!user) {
        await verifyPassword(await getDummyHash(), password);
        reply.code(401);
        return GENERIC_INVALID_CREDENTIALS;
      }

      const valid = await verifyPassword(user.passwordHash, password);
      if (!valid) {
        reply.code(401);
        return GENERIC_INVALID_CREDENTIALS;
      }

      // Rotate the session id on login so an attacker who fixated a
      // pre-login session id can't ride it into an authenticated one. See
      // rotateSession's doc comment: regenerate() alone isn't enough.
      await rotateSession(request);
      request.session.set('userId', user.id);
      await request.session.save();

      return { id: user.id, email: user.email };
    }
  );

  app.post('/auth/logout', { onRequest: csrfProtection }, async (request, reply) => {
    await request.session.destroy();
    // @fastify/session doesn't clear the cookie on destroy() by itself
    // (its onSend hook only writes/clears cookies for a live session), so
    // logout must clear it explicitly. 'sessionId' is the plugin's default
    // cookie name (see src/plugins/session.ts, which doesn't override it).
    reply.clearCookie('sessionId', { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) {
      reply.code(401);
      return GENERIC_NOT_AUTHENTICATED;
    }

    const [user] = await db.select().from(users).where(sql`${users.id} = ${userId}`);
    if (!user) {
      reply.code(401);
      return GENERIC_NOT_AUTHENTICATED;
    }

    return { id: user.id, email: user.email };
  });
};

export default authRoutes;
