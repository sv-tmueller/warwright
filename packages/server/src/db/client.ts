import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Builds a fresh pg Pool + Drizzle instance for the given connection
 * string. Callers own the returned pool's lifecycle (close it when done).
 */
export function createDb(databaseUrl: string): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
