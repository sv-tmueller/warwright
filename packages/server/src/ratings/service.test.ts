import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { DEFAULT_RATING, DEFAULT_RATING_DEVIATION, matches, ratings, users } from '../db/schema.js';
import { updateGlicko2Period } from './glicko2.js';
import { applyMatchRatings } from './service.js';

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

let emailCounter = 0;
function uniqueEmail(): string {
  emailCounter += 1;
  return `ratings-test-${Date.now()}-${emailCounter}@example.com`;
}

describe.skipIf(!url)('applyMatchRatings', () => {
  let db: Database;
  let pool: Awaited<ReturnType<typeof createDb>>['pool'];

  beforeAll(async () => {
    ({ db, pool } = createDb(url!));
    await runMigrations(url!);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function makeUser(): Promise<string> {
    const [row] = await db.insert(users).values({ email: uniqueEmail(), passwordHash: 'hash' }).returning();
    if (!row) throw new Error('user insert returned no row');
    return row.id;
  }

  async function makeMatch(userAId: string, userBId: string, winner: 'A' | 'B' | 'draw'): Promise<string> {
    const [row] = await db
      .insert(matches)
      .values({
        rulesetVersion: 2,
        seed: 1n,
        userAId,
        userBId,
        buildA: {},
        buildB: {},
        winner,
        resultHash: 1n,
      })
      .returning();
    if (!row) throw new Error('match insert returned no row');
    return row.id;
  }

  it("updates both users' ratings from a resolved match: the winner's rating rises, the loser's falls, and both RDs shrink", async () => {
    const userAId = await makeUser();
    const userBId = await makeUser();
    const matchId = await makeMatch(userAId, userBId, 'A');

    const outcome = await applyMatchRatings(db, matchId);
    expect(outcome).toBe('applied');

    const rows = await db.select().from(ratings).where(inArray(ratings.userId, [userAId, userBId]));
    const rowA = rows.find((row) => row.userId === userAId)!;
    const rowB = rows.find((row) => row.userId === userBId)!;

    expect(rowA.rating).toBeGreaterThan(DEFAULT_RATING);
    expect(rowB.rating).toBeLessThan(DEFAULT_RATING);
    expect(rowA.ratingDeviation).toBeLessThan(DEFAULT_RATING_DEVIATION);
    expect(rowB.ratingDeviation).toBeLessThan(DEFAULT_RATING_DEVIATION);

    const [matchRow] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(matchRow?.ratedAt).not.toBeNull();
  });

  it('produces deltas that exactly equal a fresh pure-function computation from the captured pre-states', async () => {
    const userAId = await makeUser();
    const userBId = await makeUser();
    // Distinct pre-match ratings so the two directions aren't symmetric by
    // coincidence.
    await db.insert(ratings).values([
      { userId: userAId, rating: 1600, ratingDeviation: 120, volatility: 0.05 },
      { userId: userBId, rating: 1450, ratingDeviation: 90, volatility: 0.07 },
    ]);
    const matchId = await makeMatch(userAId, userBId, 'B');

    const preA = { rating: 1600, ratingDeviation: 120, volatility: 0.05 };
    const preB = { rating: 1450, ratingDeviation: 90, volatility: 0.07 };
    const expectedA = updateGlicko2Period(preA, [{ opponent: preB, score: 0 }]);
    const expectedB = updateGlicko2Period(preB, [{ opponent: preA, score: 1 }]);

    await applyMatchRatings(db, matchId);

    const rows = await db.select().from(ratings).where(inArray(ratings.userId, [userAId, userBId]));
    const rowA = rows.find((row) => row.userId === userAId)!;
    const rowB = rows.find((row) => row.userId === userBId)!;

    expect(rowA.rating).toBeCloseTo(expectedA.rating, 9);
    expect(rowA.ratingDeviation).toBeCloseTo(expectedA.ratingDeviation, 9);
    expect(rowA.volatility).toBeCloseTo(expectedA.volatility, 9);
    expect(rowB.rating).toBeCloseTo(expectedB.rating, 9);
    expect(rowB.ratingDeviation).toBeCloseTo(expectedB.ratingDeviation, 9);
    expect(rowB.volatility).toBeCloseTo(expectedB.volatility, 9);
  });

  it('is idempotent: a second invocation for the same match is a no-op ("already-rated"), never double-counting', async () => {
    const userAId = await makeUser();
    const userBId = await makeUser();
    const matchId = await makeMatch(userAId, userBId, 'draw');

    const first = await applyMatchRatings(db, matchId);
    expect(first).toBe('applied');

    const rowsAfterFirst = await db.select().from(ratings).where(inArray(ratings.userId, [userAId, userBId]));

    const second = await applyMatchRatings(db, matchId);
    expect(second).toBe('already-rated');

    const rowsAfterSecond = await db.select().from(ratings).where(inArray(ratings.userId, [userAId, userBId]));
    expect(rowsAfterSecond).toEqual(rowsAfterFirst);
  });

  it('lazily creates default ratings rows for users with none, then rates from the defaults', async () => {
    const userAId = await makeUser();
    const userBId = await makeUser();
    const matchId = await makeMatch(userAId, userBId, 'draw');

    await applyMatchRatings(db, matchId);

    const rows = await db.select().from(ratings).where(inArray(ratings.userId, [userAId, userBId]));
    expect(rows.length).toBe(2);
    // A draw between two default-rated (equal) players leaves rating
    // unchanged; only RD/volatility move.
    for (const row of rows) {
      expect(row.rating).toBeCloseTo(DEFAULT_RATING, 6);
      expect(row.ratingDeviation).toBeLessThan(DEFAULT_RATING_DEVIATION);
      expect(row.volatility).toBeGreaterThan(0);
    }
  });

  it('returns "already-rated" for an unknown matchId without throwing', async () => {
    const outcome = await applyMatchRatings(db, '00000000-0000-0000-0000-000000000000');
    expect(outcome).toBe('already-rated');
  });
});
