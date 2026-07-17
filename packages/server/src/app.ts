import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Database } from './db/client.js';

export interface BuildAppOptions {
  /** Optional Drizzle database, used only by GET /readyz's SELECT 1 check. */
  db?: Database;
}

/**
 * Builds a Fastify app wired for Zod request/response validation, reusing
 * core's own schemas as the single validation source (see src/validation.
 * test.ts). /healthz is deliberately DB-free so the boot smoke test never
 * depends on Postgres being up; /readyz is DB-gated (SELECT 1) and only
 * registered when a database is supplied.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();

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

  return app;
}
