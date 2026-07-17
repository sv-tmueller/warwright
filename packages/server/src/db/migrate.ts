import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Applies every pending migration in packages/server/drizzle against the
 * given database. Idempotent: re-running against an already-migrated
 * database is a no-op. Shared by the db:migrate script, the Docker
 * entrypoint, and the migration test.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, pool } = createDb(databaseUrl);
  try {
    await drizzleMigrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }
  await runMigrations(databaseUrl);
}

// Only auto-run when executed directly (tsx src/db/migrate.ts), not when
// runMigrations is imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
