import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
  },
  (table) => [check('matches_winner_check', sql`${table.winner} in ('A', 'B', 'draw')`)]
);

export const ratings = pgTable('ratings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull().default(1500),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
