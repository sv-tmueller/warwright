import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Base schema for the server's Postgres persistence layer, shaped by later
// slices (#55 auth, #56 warband CRUD, #57 match resolution + snapshots, #58
// ratings/ladder). Keep exactly these columns; no speculative additions —
// later slices migrate the schema forward as needed.

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${table.email})`)]
);

export const warbands = pgTable(
  'warbands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Denormalized from the validated build for cheap listing.
    name: text('name').notNull(),
    // The exact CLI/client Warband JSON ({ name, units[] }); validated with
    // core's WarbandSchema on write so it round-trips across surfaces.
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('warbands_user_id_idx').on(table.userId)]
);

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Pinned at match time; core's RULESET_VERSION is currently 2.
    rulesetVersion: integer('ruleset_version').notNull(),
    // mulberry32 seeds are uint32 — exceeds the int4 range.
    seed: bigint('seed', { mode: 'bigint' }).notNull(),
    userAId: uuid('user_a_id')
      .notNull()
      .references(() => users.id),
    userBId: uuid('user_b_id')
      .notNull()
      .references(() => users.id),
    // Immutable snapshots taken at match time.
    buildA: jsonb('build_a').notNull(),
    buildB: jsonb('build_b').notNull(),
    winner: text('winner').notNull(),
    // core's MatchResult.hash is a uint32 number — also stored as bigint.
    resultHash: bigint('result_hash', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Nullable double-count guard for #110's applyMatchRatings: null means
    // "not yet rated." Set exactly once, inside the same transaction that
    // reads it via `WHERE rated_at IS NULL`, so a second invocation for the
    // same matchId is a provable no-op (see src/ratings/service.ts).
    ratedAt: timestamp('rated_at', { withTimezone: true }),
  },
  (table) => [check('matches_winner_check', sql`${table.winner} in ('A', 'B', 'draw')`)]
);

// Lazy defaults: nothing writes a `ratings` row today (that's #110's first
// rating update); a lookup miss means "never played," treated as these
// values by the matchmaking queue (see src/queue/service.ts) and by
// applyMatchRatings (see src/ratings/service.ts) without inserting a row.
// Exported so every lazy-default read stays in sync with the column
// defaults by construction, not by hardcoded literals scattered around.
export const DEFAULT_RATING = 1500;
export const DEFAULT_RATING_DEVIATION = 350;
export const DEFAULT_VOLATILITY = 0.06;

export const ratings = pgTable('ratings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Unrounded Glicko-2 output, stored at display scale (not the internal
  // μ/φ scale used by src/ratings/glicko2.ts) — double precision, not
  // integer, so nothing is lost between rating periods. Never round a
  // stored value; round only in UI presentation, if ever.
  rating: doublePrecision('rating').notNull().default(DEFAULT_RATING),
  ratingDeviation: doublePrecision('rating_deviation').notNull().default(DEFAULT_RATING_DEVIATION),
  volatility: doublePrecision('volatility').notNull().default(DEFAULT_VOLATILITY),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Shaped to match connect-pg-simple's expected session-store table exactly
// (sid PK, sess json, expire timestamp(6) + an index on expire).
// createTableIfMissing is set to false when the store is wired up (see
// src/plugins/session.ts) so drizzle stays the single schema owner.
export const sessions = pgTable(
  'sessions',
  {
    sid: varchar('sid', { length: 255 }).primaryKey(),
    sess: json('sess').notNull(),
    expire: timestamp('expire', { precision: 6, withTimezone: false }).notNull(),
  },
  (table) => [index('sessions_expire_idx').on(table.expire)]
);
