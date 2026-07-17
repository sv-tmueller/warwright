import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Pool } from 'pg';
import type { Database } from './db/client.js';
import sessionPlugin from './plugins/session.js';

// Rejects request bodies over 64 KiB with a 413, per #55's auth hardening
// (Fastify's own default is 1 MiB, generous for JSON auth payloads).
const BODY_LIMIT_BYTES = 64 * 1024;

export interface SessionConfig {
  secret: string;
  cookieSecure: boolean;
}

export interface BuildAppOptions {
  /** Optional Drizzle database, used by GET /readyz's SELECT 1 check and the auth routes. */
  db?: Database;
  /** Optional pg Pool, backing the connect-pg-simple session store. */
  pool?: Pool;
  /** Optional session/CSRF config; the session plugin and auth routes are only registered when db, pool, and session are all supplied. */
  session?: SessionConfig;
}

/**
 * Builds a Fastify app wired for Zod request/response validation, reusing
 * core's own schemas as the single validation source (see src/validation.
 * test.ts). /healthz is deliberately DB-free so the boot smoke test never
 * depends on Postgres being up; /readyz is DB-gated (SELECT 1) and only
 * registered when a database is supplied. The session/CSRF plugin is only
 * registered when db, pool, and session are all supplied, mirroring
 * /readyz's DB-free-test gating.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ bodyLimit: BODY_LIMIT_BYTES }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.get('/healthz', async () => ({ status: 'ok' }));

  if (options.db) {
    const db = options.db;
    app.get('/readyz', async () => {
      await db.execute(sql`SELECT 1`);
      return { status: 'ok' };
    });
  }

  if (options.db && options.pool && options.session) {
    void app.register(sessionPlugin, {
      pool: options.pool,
      secret: options.session.secret,
      cookieSecure: options.session.cookieSecure,
    });
  }

  return app;
}
