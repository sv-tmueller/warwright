import fastifyCookie from '@fastify/cookie';
import fastifyCsrfProtection from '@fastify/csrf-protection';
import fastifySession from '@fastify/session';
import connectPgSimple from 'connect-pg-simple';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

export interface SessionPluginOptions {
  /** The shared pg Pool; connect-pg-simple reads/writes the "sessions" table on it. */
  pool: Pool;
  /** Signs session cookies and CSRF secrets. Required, at least 32 chars (see config.ts). */
  secret: string;
  /** Whether the session cookie gets the `secure` attribute (prod: true, local dev: false). */
  cookieSecure: boolean;
}

// Sessions live 7 days; matches the cookie's maxAge.
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// connect-pg-simple is built as an express-session store; it only needs a
// `.Store` base class to extend, which @fastify/session also exports (its
// own type declarations describe an express-session-shaped factory
// function, which @fastify/session's default export isn't, hence the cast).
const PgSessionStore = connectPgSimple(
  fastifySession as unknown as Parameters<typeof connectPgSimple>[0]
);

async function sessionPlugin(app: FastifyInstance, options: SessionPluginOptions): Promise<void> {
  const store = new PgSessionStore({
    pool: options.pool,
    tableName: 'sessions',
    // Drizzle (src/db/schema.ts) is the single owner of the "sessions"
    // table's schema; connect-pg-simple must never try to create it.
    createTableIfMissing: false,
    // Without this, connect-pg-simple starts a setInterval pruner that
    // keeps the Node process (and vitest) alive after tests finish.
    pruneSessionInterval: false,
  });

  await app.register(fastifyCookie);
  await app.register(fastifySession, {
    secret: options.secret,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: options.cookieSecure,
      maxAge: SESSION_MAX_AGE_MS,
    },
    store,
  });
  await app.register(fastifyCsrfProtection, { sessionPlugin: '@fastify/session' });

  app.addHook('onClose', () => {
    store.close();
  });
}

// fp() breaks plugin encapsulation so the session/cookie/CSRF decorators
// (request.session, app.csrfProtection, reply.generateCsrf) attach to the
// parent app instance and are visible to routes registered as siblings
// (e.g. src/auth/routes.ts), not just to descendants of this plugin.
export default fp(sessionPlugin, { name: 'warwright-session' });
