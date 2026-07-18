import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { matches, ratings } from '../db/schema.js';
import { updateGlicko2Period, type GlickoPlayer } from './glicko2.js';

export type ApplyMatchRatingsOutcome = 'applied' | 'already-rated';

function scoreFor(side: 'A' | 'B', winner: string): 0 | 0.5 | 1 {
  if (winner === 'draw') return 0.5;
  return winner === side ? 1 : 0;
}

/**
 * Rates one resolved match, updating both players' `ratings` rows in a
 * single transaction. Idempotent by construction: the leading `UPDATE
 * matches ... WHERE rated_at IS NULL` both claims the match (so a second
 * concurrent or later call sees zero rows and is a safe no-op) and reads
 * the data needed to rate it, in one round trip.
 *
 * Call this only after a match has been durably persisted by resolveMatch
 * (see src/queue/routes.ts's post-resolve hook) — never speculatively.
 */
export async function applyMatchRatings(db: Database, matchId: string): Promise<ApplyMatchRatingsOutcome> {
  return db.transaction(async (tx) => {
    const [matchRow] = await tx
      .update(matches)
      .set({ ratedAt: new Date() })
      .where(and(eq(matches.id, matchId), isNull(matches.ratedAt)))
      .returning({ userAId: matches.userAId, userBId: matches.userBId, winner: matches.winner });

    if (!matchRow) {
      return 'already-rated';
    }

    const { userAId, userBId, winner } = matchRow;

    // Deadlock-safe: both the upsert and the row-lock select below touch
    // both users' rows in the same, stable (ascending userId) order,
    // regardless of which of them is "A" or "B" for this particular match —
    // load-bearing under concurrent matches sharing a player.
    const orderedIds = [userAId, userBId].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    // Lazy default rows (see DEFAULT_RATING/DEFAULT_RATING_DEVIATION/
    // DEFAULT_VOLATILITY in schema.ts): a user who has never had a rating
    // written starts from these defaults, same as the queue's lazy read.
    await tx
      .insert(ratings)
      .values(orderedIds.map((userId) => ({ userId })))
      .onConflictDoNothing();

    const rows = await tx
      .select()
      .from(ratings)
      .where(inArray(ratings.userId, orderedIds))
      .orderBy(ratings.userId)
      .for('update');

    const rowA = rows.find((row) => row.userId === userAId);
    const rowB = rows.find((row) => row.userId === userBId);
    if (!rowA || !rowB) throw new Error('applyMatchRatings: expected both ratings rows to exist after upsert');

    const playerA: GlickoPlayer = {
      rating: rowA.rating,
      ratingDeviation: rowA.ratingDeviation,
      volatility: rowA.volatility,
    };
    const playerB: GlickoPlayer = {
      rating: rowB.rating,
      ratingDeviation: rowB.ratingDeviation,
      volatility: rowB.volatility,
    };

    const newA = updateGlicko2Period(playerA, [{ opponent: playerB, score: scoreFor('A', winner) }]);
    const newB = updateGlicko2Period(playerB, [{ opponent: playerA, score: scoreFor('B', winner) }]);

    const updatedAt = new Date();
    await tx.update(ratings).set({ ...newA, updatedAt }).where(eq(ratings.userId, userAId));
    await tx.update(ratings).set({ ...newB, updatedAt }).where(eq(ratings.userId, userBId));

    return 'applied';
  });
}
