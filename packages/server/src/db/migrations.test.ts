import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWarband } from '@warwright/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from './client.js';
import { runMigrations } from './migrate.js';
import { users, warbands } from './schema.js';

const url = process.env.DATABASE_URL;

// DB tests can never silently skip in CI: if CI has no DATABASE_URL, that is
// a broken pipeline, not an empty test suite.
if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

const sampleWarbandPath = fileURLToPath(
  new URL('../../../../builds/warband-a.json', import.meta.url)
);
const sampleWarband: unknown = JSON.parse(readFileSync(sampleWarbandPath, 'utf-8'));

describe.skipIf(!url)('migrations', () => {
  let db: Database;
  let pool: { end: () => Promise<void> };

  beforeAll(async () => {
    // Reset to a genuinely clean state so the test is rerunnable locally.
    // Drop the "drizzle" schema too: it holds the migrations-tracking table
    // (__drizzle_migrations), and leaving it behind while wiping "public"
    // would make the migrator think migrations already ran and skip
    // re-creating the tables, silently leaving "public" empty.
    ({ db, pool } = createDb(url!));
    await db.execute(
      sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;`
    );
    await runMigrations(url!);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates the four base tables', async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tableNames = result.rows.map((row) => row.table_name);

    expect(tableNames).toEqual(['matches', 'ratings', 'users', 'warbands']);
  });

  it('creates the expected key columns', async () => {
    const result = await db.execute<{ table_name: string; column_name: string }>(
      sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`
    );
    const columns = result.rows.map((row) => `${row.table_name}.${row.column_name}`);

    expect(columns).toEqual(
      expect.arrayContaining([
        'users.id',
        'users.email',
        'users.password_hash',
        'users.created_at',
        'warbands.id',
        'warbands.user_id',
        'warbands.name',
        'warbands.data',
        'warbands.created_at',
        'warbands.updated_at',
        'matches.id',
        'matches.ruleset_version',
        'matches.seed',
        'matches.user_a_id',
        'matches.user_b_id',
        'matches.build_a',
        'matches.build_b',
        'matches.winner',
        'matches.result_hash',
        'matches.created_at',
        'ratings.user_id',
        'ratings.rating',
        'ratings.updated_at',
      ])
    );
  });

  it('is idempotent: re-running the migrator against an already-migrated database is a no-op', async () => {
    await expect(runMigrations(url!)).resolves.not.toThrow();
  });

  it('round-trips a warband through jsonb: insert, read back, parseWarband equals input', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: 'roundtrip@example.com', passwordHash: 'hash' })
      .returning();
    if (!user) throw new Error('user insert returned no row');

    const [warband] = await db
      .insert(warbands)
      .values({ userId: user.id, name: 'Iron Vanguard', data: sampleWarband })
      .returning();
    if (!warband) throw new Error('warband insert returned no row');

    const [readBack] = await db.select().from(warbands).where(eq(warbands.id, warband.id));
    if (!readBack) throw new Error('warband read-back returned no row');

    expect(parseWarband(readBack.data)).toEqual(parseWarband(sampleWarband));
  });
});
