import type { MatchResult } from '@warwright/core';

/** One player's intent to be matched: their saved-warband snapshot, rating (lazily defaulted, see schema.ts's DEFAULT_RATING), and FIFO tie-break timestamp. */
export interface WaitingEntry {
  userId: string;
  rating: number;
  /** The warband's `data` column, fetched at enqueue time (see decision 2) so pairing itself needs no I/O. */
  build: unknown;
  enqueuedAt: number;
}

/** The two sides of a resolved-or-resolving pairing, ready to hand to resolveMatch unchanged. */
export interface Pairing {
  userAId: string;
  buildA: unknown;
  userBId: string;
  buildB: unknown;
  /**
   * The opponent's original queue entry, kept only so failPairing can
   * restore it byte-for-byte (unchanged rating/build/enqueuedAt) at the
   * head of the queue if resolveMatch rejects. Not part of the public
   * pairing contract routes should read from.
   */
  entryA: WaitingEntry;
}

export type EnqueueOutcome =
  | { status: 'waiting' }
  | { status: 'already-queued' }
  | { status: 'paired'; pairing: Pairing };

export type QueueStatus =
  | { status: 'matched'; matchId: string; result: MatchResult }
  | { status: 'waiting' }
  | { status: 'idle' };

export type DequeueOutcome = 'removed' | 'not-queued' | 'resolving';

/**
 * Pure selector: among `candidates` (typically all currently-waiting
 * entries), returns the one nearest in rating to `myRating`, excluding
 * `myUserId` itself (defense in depth — enqueue() also never adds a second
 * entry for an already-queued user, so self-pairing can't arise from the
 * caller appearing in `candidates`). Ties break on earliest `enqueuedAt`
 * (FIFO). Returns undefined when no eligible candidate exists.
 */
export function selectOpponent(
  candidates: readonly WaitingEntry[],
  myUserId: string,
  myRating: number
): WaitingEntry | undefined {
  let best: WaitingEntry | undefined;
  let bestDiff = Infinity;

  for (const candidate of candidates) {
    if (candidate.userId === myUserId) continue;
    const diff = Math.abs(candidate.rating - myRating);
    if (best === undefined || diff < bestDiff || (diff === bestDiff && candidate.enqueuedAt < best.enqueuedAt)) {
      best = candidate;
      bestDiff = diff;
    }
  }

  return best;
}

/**
 * In-memory matchmaking queue: per-user state machine
 * `idle -> waiting -> resolving -> matched (unclaimed) -> idle`.
 *
 * NO-AWAIT INVARIANT (load-bearing): every method on this class is
 * synchronous. Node's single-threaded, run-to-completion execution means a
 * synchronous method body can never be interleaved with another request's
 * handler — it IS the critical section. That's the entire concurrency
 * argument for pairing correctness (no locks, no DB row-level locking, no
 * races between two POSTs). Callers (queue/routes.ts) MUST do every await
 * (session lookup, warband fetch, rating read) BEFORE calling enqueue(),
 * and MUST only call resolveMatch — the one necessarily-async step — AFTER
 * enqueue() has returned a 'paired' outcome (i.e. after both entries have
 * already been synchronously removed from `waiting` and moved to
 * `resolving`). If any future change adds an await inside this class, or
 * inserts one between reading queue state and calling one of these
 * methods, the critical section is broken and two concurrent joiners can
 * both pair against the same waiting entry. Do not do that.
 *
 * Must be instantiated fresh per `buildApp()` call (inside the route
 * plugin, never at module scope): tests build multiple independent apps
 * against one shared Postgres instance, and app instances must not share
 * queue state. State is lost on process restart by design — see decision 1
 * in the #57 sub-plan and the README's caveat; reproducibility lives
 * entirely in the persisted `matches` rows, not in this queue.
 */
export class QueueService {
  private readonly waiting = new Map<string, WaitingEntry>();
  private readonly resolving = new Set<string>();
  private readonly matchedResults = new Map<string, { matchId: string; result: MatchResult }>();

  /** Side-effect-free status read for GET /queue. A matched result is retained (not cleared) until the next enqueue(). */
  getStatus(userId: string): QueueStatus {
    const matched = this.matchedResults.get(userId);
    if (matched) return { status: 'matched', matchId: matched.matchId, result: matched.result };
    if (this.waiting.has(userId) || this.resolving.has(userId)) return { status: 'waiting' };
    return { status: 'idle' };
  }

  /**
   * Synchronous pairing attempt for POST /queue. Already-waiting or
   * already-resolving users get 'already-queued' (409 source; also the
   * first of the two no-self-pairing guards — selectOpponent's own
   * self-exclusion is the second). Otherwise clears any stale unclaimed
   * result (a fresh enqueue supersedes it) and either enqueues as waiting
   * or, if selectOpponent finds an eligible opponent, atomically removes
   * that opponent from `waiting`, marks both users `resolving`, and
   * returns the pairing for the caller to hand to resolveMatch. The
   * earlier-enqueued player (the one already waiting) is always A; the
   * joiner is B — see the #57 sub-plan's endpoint contract.
   */
  enqueue(userId: string, rating: number, build: unknown): EnqueueOutcome {
    if (this.waiting.has(userId) || this.resolving.has(userId)) {
      return { status: 'already-queued' };
    }

    this.matchedResults.delete(userId);

    const opponent = selectOpponent([...this.waiting.values()], userId, rating);
    if (!opponent) {
      this.waiting.set(userId, { userId, rating, build, enqueuedAt: Date.now() });
      return { status: 'waiting' };
    }

    this.waiting.delete(opponent.userId);
    this.resolving.add(opponent.userId);
    this.resolving.add(userId);

    return {
      status: 'paired',
      pairing: {
        userAId: opponent.userId,
        buildA: opponent.build,
        userBId: userId,
        buildB: build,
        entryA: opponent,
      },
    };
  }

  /** Called after resolveMatch resolves: moves both users from resolving to matched (unclaimed). */
  completePairing(pairing: Pairing, matchId: string, result: MatchResult): void {
    this.resolving.delete(pairing.userAId);
    this.resolving.delete(pairing.userBId);
    this.matchedResults.set(pairing.userAId, { matchId, result });
    this.matchedResults.set(pairing.userBId, { matchId, result });
  }

  /**
   * Called after resolveMatch rejects: restores A (the opponent) unchanged
   * at the head of the queue so they aren't punished for B's failure. B
   * (the joiner whose POST is about to 500) is simply released back to
   * idle — not re-queued automatically.
   */
  failPairing(pairing: Pairing): void {
    this.resolving.delete(pairing.userAId);
    this.resolving.delete(pairing.userBId);
    this.waiting.set(pairing.userAId, pairing.entryA);
  }

  /** DELETE /queue: removes a waiting user (204), 404s a user who isn't queued (includes idle and matched-but-unclaimed), 409s a user mid-resolution. */
  dequeue(userId: string): DequeueOutcome {
    if (this.resolving.has(userId)) return 'resolving';
    if (this.waiting.delete(userId)) return 'removed';
    return 'not-queued';
  }
}

export function createQueueService(): QueueService {
  return new QueueService();
}
