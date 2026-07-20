import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { DEFAULT_RATING, DEFAULT_RATING_DEVIATION, DEFAULT_VOLATILITY, matches, ratings, users } from '../db/schema.js';
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

  describe('concurrency / FOR UPDATE locking', () => {
    // Deterministic synchronization point, not a sleep-based assertion:
    // polls pg_stat_activity until `n` backends are observed blocked
    // (wait_event_type = 'Lock') on a query matching `queryPattern`. Bounded
    // by the enclosing test's timeout, not by elapsed wall-clock time — the
    // loop's own pass/fail never depends on how long it took to converge.
    //
    // Deliberately does NOT use pg_blocking_pids(...) containment of a
    // specific pid: Postgres queues a second waiter behind the first
    // waiter's own tuple lock, so the second waiter's blocking pid is the
    // first waiter, not the raw client holding the original lock.
    // wait_event_type = 'Lock' counts every blocked backend correctly
    // regardless of queue position.
    async function waitForLockWaiters(n: number, queryPattern: RegExp, timeoutMs = 10_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const { rows } = await pool.query<{ query: string }>(
          "SELECT query FROM pg_stat_activity WHERE wait_event_type = 'Lock'"
        );
        const matching = rows.filter((row) => queryPattern.test(row.query));
        if (matching.length >= n) return;
        if (Date.now() >= deadline) {
          throw new Error(
            `waitForLockWaiters: timed out waiting for ${n} backend(s) blocked matching ${queryPattern}; ` +
              `saw ${matching.length} of ${rows.length} total lock waiters`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    it(
      'two concurrent applyMatchRatings(sameMatchId) calls: exactly one applied, one already-rated, rows updated once',
      async () => {
        const userAId = await makeUser();
        const userBId = await makeUser();
        const matchId = await makeMatch(userAId, userBId, 'A');

        // Both users start from the lazy defaults (no pre-inserted rows);
        // this is the single-application recomputation the final rows must
        // match, proving the double-apply did not double-count.
        const preA = { rating: DEFAULT_RATING, ratingDeviation: DEFAULT_RATING_DEVIATION, volatility: DEFAULT_VOLATILITY };
        const preB = { rating: DEFAULT_RATING, ratingDeviation: DEFAULT_RATING_DEVIATION, volatility: DEFAULT_VOLATILITY };
        const expectedA = updateGlicko2Period(preA, [{ opponent: preB, score: 1 }]);
        const expectedB = updateGlicko2Period(preB, [{ opponent: preA, score: 0 }]);

        const rawClient = await pool.connect();
        try {
          // Gate the claim UPDATE by locking the matches row first, so both
          // applyMatchRatings calls are provably in flight (both blocked on
          // the claim UPDATE) before either is allowed to proceed. A bare
          // Promise.all of two applies could serialize by accident and pass
          // vacuously; this control rules that out.
          await rawClient.query('BEGIN');
          await rawClient.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [matchId]);

          const p1 = applyMatchRatings(db, matchId);
          const p2 = applyMatchRatings(db, matchId);

          await waitForLockWaiters(2, /"matches"/);

          await rawClient.query('COMMIT');

          const outcomes = (await Promise.all([p1, p2])).sort();
          // Never assert which promise won — wake order belongs to
          // Postgres; asserting it would reintroduce flakiness.
          expect(outcomes).toEqual(['already-rated', 'applied']);
        } finally {
          // ROLLBACK is a harmless no-op once already committed; this just
          // guarantees a failed assertion above can never wedge afterAll's
          // pool.end() with an open transaction.
          await rawClient.query('ROLLBACK');
          rawClient.release();
        }

        const rows = await db.select().from(ratings).where(inArray(ratings.userId, [userAId, userBId]));
        const rowA = rows.find((row) => row.userId === userAId)!;
        const rowB = rows.find((row) => row.userId === userBId)!;
        expect(rowA.rating).toBeCloseTo(expectedA.rating, 9);
        expect(rowA.ratingDeviation).toBeCloseTo(expectedA.ratingDeviation, 9);
        expect(rowA.volatility).toBeCloseTo(expectedA.volatility, 9);
        expect(rowB.rating).toBeCloseTo(expectedB.rating, 9);
        expect(rowB.ratingDeviation).toBeCloseTo(expectedB.ratingDeviation, 9);
        expect(rowB.volatility).toBeCloseTo(expectedB.volatility, 9);

        const [matchRow] = await db.select().from(matches).where(eq(matches.id, matchId));
        expect(matchRow?.ratedAt).not.toBeNull();
      },
      15_000
    );

    it(
      'a concurrent applyMatchRatings blocks on a shared player\'s locked ratings row, then lands on sequential-equivalent values',
      async () => {
        const userAId = await makeUser();
        const userBId = await makeUser();
        // Distinct pre-match ratings, as in the exact-computation test above.
        await db.insert(ratings).values([
          { userId: userAId, rating: 1600, ratingDeviation: 120, volatility: 0.05 },
          { userId: userBId, rating: 1450, ratingDeviation: 90, volatility: 0.07 },
        ]);
        const matchId = await makeMatch(userAId, userBId, 'B');

        const preB = { rating: 1450, ratingDeviation: 90, volatility: 0.07 };
        // The value the raw client commits for A while applyMatchRatings is
        // blocked — the READ COMMITTED value the blocked call must re-read
        // once unblocked, not the stale pre-lock value it observed before
        // waiting.
        const postLockA = { rating: 1620, ratingDeviation: 118, volatility: 0.051 };
        const expectedA = updateGlicko2Period(postLockA, [{ opponent: preB, score: 0 }]);
        const expectedB = updateGlicko2Period(preB, [{ opponent: postLockA, score: 1 }]);

        let settled = false;
        const rawClient = await pool.connect();
        try {
          await rawClient.query('BEGIN');
          await rawClient.query('SELECT * FROM ratings WHERE user_id = $1 FOR UPDATE', [userAId]);
          // Simulates a concurrent match write for the shared player, still
          // open in the same transaction — this makes "sequential-
          // equivalent" a real assertion rather than a tautology.
          await rawClient.query(
            'UPDATE ratings SET rating = $1, rating_deviation = $2, volatility = $3 WHERE user_id = $4',
            [postLockA.rating, postLockA.ratingDeviation, postLockA.volatility, userAId]
          );

          const applyPromise = applyMatchRatings(db, matchId);
          void applyPromise.then(
            () => {
              settled = true;
            },
            () => {
              settled = true;
            }
          );

          // The raw client's own in-transaction UPDATE (above) leaves an
          // uncommitted new tuple version, so applyMatchRatings actually
          // blocks one statement earlier than its own `SELECT ... FOR
          // UPDATE`: at the lazy-default `INSERT ... ON CONFLICT DO
          // NOTHING` upsert, whose conflict check must wait for that
          // uncommitted version to resolve. (Verified empirically against
          // pg_stat_activity — a bare `SELECT ... FOR UPDATE` with no
          // accompanying UPDATE blocks at the later `FOR UPDATE` select
          // instead, as ON CONFLICT DO NOTHING does not wait on a row that
          // is merely lock-held, not modified.) Match on the ratings table
          // rather than a specific statement so the assertion holds
          // regardless of exactly which of applyMatchRatings' own
          // statements is the one left waiting.
          await waitForLockWaiters(1, /"ratings"/);
          // The promise-gate proof that the call is genuinely blocked, not
          // merely unscheduled.
          expect(settled).toBe(false);

          await rawClient.query('COMMIT');

          const outcome = await applyPromise;
          expect(outcome).toBe('applied');
          expect(settled).toBe(true);
        } finally {
          // ROLLBACK is a harmless no-op once already committed; this just
          // guarantees a failed assertion above can never wedge afterAll's
          // pool.end() with an open transaction.
          await rawClient.query('ROLLBACK');
          rawClient.release();
        }

        const rows = await db.select().from(ratings).where(inArray(ratings.userId, [userAId, userBId]));
        const rowA = rows.find((row) => row.userId === userAId)!;
        const rowB = rows.find((row) => row.userId === userBId)!;
        expect(rowA.rating).toBeCloseTo(expectedA.rating, 9);
        expect(rowA.ratingDeviation).toBeCloseTo(expectedA.ratingDeviation, 9);
        expect(rowA.volatility).toBeCloseTo(expectedA.volatility, 9);
        expect(rowB.rating).toBeCloseTo(expectedB.rating, 9);
        expect(rowB.ratingDeviation).toBeCloseTo(expectedB.ratingDeviation, 9);
        expect(rowB.volatility).toBeCloseTo(expectedB.volatility, 9);
      },
      15_000
    );
  });
});
