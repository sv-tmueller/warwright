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
   * Both original queue entries, kept only so failPairing can restore them
   * byte-for-byte (unchanged rating/build/enqueuedAt) if resolution rejects.
   * Not part of the public pairing contract routes should read from.
   *
   * Since #108: both entries are kept (not just A's). Under #57, B was "the
   * joiner whose POST is about to 500" and the 500 itself was B's error
   * channel, so only A needed restoring. Under timer-driven pairing there is
   * no request to 500 a failure through, so B needs restoring too, or they'd
   * be silently ejected to idle.
   */
  entryA: WaitingEntry;
  entryB: WaitingEntry;
}

export type EnqueueOutcome = { status: 'waiting' } | { status: 'already-queued' };

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
 *
 * Unchanged by #108: only the accumulation policy around this function
 * changed (see QueueService's pairing-pass doc comment below); the selector
 * itself, and its own unit tests, stayed exactly as #57 shipped them.
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
 * Injectable clock/timer seam so QueueService never touches `setTimeout`/
 * `Date.now` directly. Production uses `defaultScheduler` (real timers);
 * tests use `createManualScheduler()`, which requires an explicit `fire()`
 * call instead of real elapsed time. This deliberately avoids Vitest's
 * `vi.useFakeTimers()`, which would globally stub `setTimeout` and interfere
 * with `pg`'s own internal connection timers in the DB-gated queue suite.
 */
export interface Scheduler {
  now(): number;
  schedule(callback: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

/** Real-timer scheduler; the default for `createQueueService()` in production. */
export const defaultScheduler: Scheduler = {
  now: () => Date.now(),
  schedule: (callback, ms) => setTimeout(callback, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A scheduler's single pending timer, as tracked by `createManualScheduler()`. */
interface PendingTimer {
  id: number;
  callback: () => void;
  ms: number;
}

/** A `Scheduler` a test fully controls: `schedule()` never actually waits; a test calls `fire()` to run the pending callback on demand. */
export interface ManualScheduler extends Scheduler {
  /**
   * Runs the single pending timer's callback now (throws if none is
   * pending) and returns the callback's return value coerced to a promise,
   * so a test can `await scheduler.fire()` to await the pairing pass it
   * triggers to quiescence.
   */
  fire(): Promise<void>;
  /** Whether a timer is currently armed. */
  readonly pending: boolean;
  /** The `ms` most recently passed to `schedule()` for the still-pending timer, or undefined if none is pending. */
  readonly pendingMs: number | undefined;
  /** Total number of times `schedule()` has been called (arm events), for asserting arm/re-arm behavior in tests. */
  readonly scheduleCount: number;
}

/**
 * Builds a `ManualScheduler`: `now()` is a simple counter a test can't need
 * to advance for these tests (the pairing pass reads timestamps only to
 * FIFO-sort, never to check elapsed time), and `schedule()` records exactly
 * one pending timer at a time (QueueService's own armed-at-most-once
 * invariant means it never asks for two), fired only by an explicit call to
 * `fire()`.
 */
export function createManualScheduler(): ManualScheduler {
  let clock = 0;
  let nextId = 1;
  let current: PendingTimer | undefined;
  let scheduleCount = 0;

  return {
    // A monotonically-increasing logical tick, not wall time: every call
    // advances it, so each enqueue() gets a genuinely distinct enqueuedAt —
    // load-bearing for proving the pairing pass really sorts by timestamp
    // (see collectPairings's doc comment on failPairing restores preserving
    // original order) rather than incidentally matching Map insertion order.
    now: () => {
      clock += 1;
      return clock;
    },
    schedule(callback, ms) {
      const id = nextId;
      nextId += 1;
      current = { id, callback, ms };
      scheduleCount += 1;
      return id;
    },
    cancel(handle) {
      if (current?.id === handle) {
        current = undefined;
      }
    },
    fire() {
      if (!current) {
        throw new Error('createManualScheduler: fire() called with no pending timer');
      }
      const { callback } = current;
      current = undefined;
      const result = callback() as void | Promise<void>;
      return Promise.resolve(result);
    },
    get pending() {
      return current !== undefined;
    },
    get pendingMs() {
      return current?.ms;
    },
    get scheduleCount() {
      return scheduleCount;
    },
  };
}

/** Default batching-window duration (ms): see config.ts's QUEUE_WINDOW_MS. */
export const DEFAULT_QUEUE_WINDOW_MS = 5000;
/** Default pool-size pairing trigger (K): see config.ts's QUEUE_MAX_POOL. */
export const DEFAULT_QUEUE_MAX_POOL = 8;

export interface QueueServiceOptions {
  /**
   * Invoked with every pairing a pass produces. Constructed by
   * queue/routes.ts, closing over `db`/`app.log`/this same QueueService so
   * it can call resolveMatch, then completePairing or (on any error)
   * failPairing. MUST catch everything itself and never reject: this runs
   * from inside a timer callback (or synchronously-triggered pass), and an
   * unhandled rejection there would crash the process, not 500 a request.
   * QueueService defensively swallows an escaping rejection anyway (see
   * runPass below), but that is not a substitute for the resolver's own
   * try/catch.
   */
  resolver: (pairings: Pairing[]) => Promise<void>;
  /** Batching-window duration in ms. Defaults to DEFAULT_QUEUE_WINDOW_MS. */
  windowMs?: number;
  /** Pool size (K) that triggers an immediate pass. Defaults to DEFAULT_QUEUE_MAX_POOL. */
  maxPool?: number;
  /** Clock/timer seam. Defaults to real timers (defaultScheduler). */
  scheduler?: Scheduler;
}

/**
 * In-memory matchmaking queue: per-user state machine
 * `idle -> waiting -> resolving -> matched (unclaimed) -> idle`.
 *
 * ACCUMULATION POLICY (since #108): `enqueue()` never pairs inline — it
 * always adds the caller to `waiting` and returns 'waiting' or
 * 'already-queued'. Pairing happens in a separate, fully synchronous
 * **pairing pass** (see `runPass`/`collectPairings` below), triggered by
 * either:
 *   - a single timer, armed via `scheduler.schedule` the moment the pool
 *     becomes pairable (size reaches 2 with no timer already pending),
 *     firing `windowMs` later; or
 *   - the pool reaching `maxPool` (K) on an enqueue, which cancels any
 *     pending timer and runs the pass immediately, synchronously, from
 *     inside that enqueue() call.
 *
 * NO-AWAIT INVARIANT (load-bearing, extended by #108 to the pass and the
 * timer callback): every *mutation* of `waiting`/`resolving` — inside
 * enqueue(), the pairing pass, completePairing, and failPairing — is
 * synchronous. Node's single-threaded, run-to-completion execution means a
 * synchronous function body can never be interleaved with another request's
 * handler or another timer firing — each one of these calls IS a complete
 * critical section. That is what makes two concurrent POSTs, or a POST
 * racing a timer-triggered pass, safe without locks. The one intentionally
 * asynchronous step is the injected `resolver` (ultimately resolveMatch),
 * which the pass fires off *after* the synchronous pool mutation has
 * already moved every paired user to `resolving` — a rejection or delay in
 * `resolver` can therefore never cause a double-pair. If any future change
 * adds an await inside a pool-mutating method, or between reading queue
 * state and mutating it, this invariant breaks. Do not do that.
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

  private readonly resolver: (pairings: Pairing[]) => Promise<void>;
  private readonly windowMs: number;
  private readonly maxPool: number;
  private readonly scheduler: Scheduler;

  private timerHandle: unknown | undefined;
  /** The most recently started pass's settling promise, for tests (and `settled()`) to await quiescence deterministically. */
  private pendingPassPromise: Promise<void> | undefined;

  constructor(options: QueueServiceOptions) {
    this.resolver = options.resolver;
    this.windowMs = options.windowMs ?? DEFAULT_QUEUE_WINDOW_MS;
    this.maxPool = options.maxPool ?? DEFAULT_QUEUE_MAX_POOL;
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  /** Side-effect-free status read for GET /queue. A matched result is retained (not cleared) until the next enqueue(). */
  getStatus(userId: string): QueueStatus {
    const matched = this.matchedResults.get(userId);
    if (matched) return { status: 'matched', matchId: matched.matchId, result: matched.result };
    if (this.waiting.has(userId) || this.resolving.has(userId)) return { status: 'waiting' };
    return { status: 'idle' };
  }

  /**
   * POST /queue's entire synchronous critical section. Already-waiting or
   * already-resolving users get 'already-queued' (409 source; also the
   * first of the two no-self-pairing guards — selectOpponent's own
   * self-exclusion is the second). Otherwise clears any stale unclaimed
   * result (a fresh enqueue supersedes it) and adds the caller to
   * `waiting`. Never pairs inline (see the class doc comment's
   * accumulation-policy section): the caller always gets 'waiting' here.
   * If this enqueue brings the pool to `maxPool`, a pairing pass runs
   * immediately (synchronously mutating queue state, asynchronously
   * resolving); otherwise the batching-window timer is armed if the pool
   * just became pairable.
   */
  enqueue(userId: string, rating: number, build: unknown): EnqueueOutcome {
    if (this.waiting.has(userId) || this.resolving.has(userId)) {
      return { status: 'already-queued' };
    }

    this.matchedResults.delete(userId);
    this.waiting.set(userId, { userId, rating, build, enqueuedAt: this.scheduler.now() });

    if (this.waiting.size >= this.maxPool) {
      this.clearTimer();
      this.pendingPassPromise = this.runPass();
    } else {
      this.armTimerIfPairable();
    }

    return { status: 'waiting' };
  }

  /** Called after resolveMatch resolves: moves both users from resolving to matched (unclaimed). */
  completePairing(pairing: Pairing, matchId: string, result: MatchResult): void {
    this.resolving.delete(pairing.userAId);
    this.resolving.delete(pairing.userBId);
    this.matchedResults.set(pairing.userAId, { matchId, result });
    this.matchedResults.set(pairing.userBId, { matchId, result });
  }

  /**
   * Called after the resolver's resolveMatch call rejects: restores BOTH
   * entries, unchanged, to the queue (see Pairing.entryA/entryB's doc
   * comment for why both, not just A, since #108) and re-arms the
   * batching-window timer if that restoration makes the pool pairable
   * again.
   */
  failPairing(pairing: Pairing): void {
    this.resolving.delete(pairing.userAId);
    this.resolving.delete(pairing.userBId);
    this.waiting.set(pairing.userAId, pairing.entryA);
    this.waiting.set(pairing.userBId, pairing.entryB);
    this.armTimerIfPairable();
  }

  /** DELETE /queue: removes a waiting user (204), 404s a user who isn't queued (includes idle and matched-but-unclaimed), 409s a user mid-resolution. */
  dequeue(userId: string): DequeueOutcome {
    if (this.resolving.has(userId)) return 'resolving';
    if (this.waiting.delete(userId)) return 'removed';
    return 'not-queued';
  }

  /**
   * Returns the most recently started pairing pass's settling promise (or
   * an already-resolved promise if none is in flight), so a caller — tests,
   * mainly, for the K-trigger path where no timer/`fire()` is involved —
   * can `await` the pass to quiescence deterministically.
   */
  settled(): Promise<void> {
    return this.pendingPassPromise ?? Promise.resolve();
  }

  /** Cancels any pending batching-window timer. Called from routes.ts's `onClose` hook (same lifecycle precedent as the session pruner in plugins/session.ts) so a live app shutdown never leaves a dangling timer. */
  dispose(): void {
    this.clearTimer();
  }

  private armTimerIfPairable(): void {
    if (this.timerHandle !== undefined) return;
    if (this.waiting.size < 2) return;
    this.timerHandle = this.scheduler.schedule(() => {
      this.timerHandle = undefined;
      const promise = this.runPass();
      this.pendingPassPromise = promise;
      // The Scheduler interface types this callback as `() => void` (a
      // real setTimeout callback's return value is ignored), but returning
      // the pass's promise anyway is what lets createManualScheduler's
      // fire() hand it back to a caller (see ManualScheduler.fire's doc
      // comment) — TypeScript's void-return leniency allows this.
      return promise;
    }, this.windowMs);
  }

  private clearTimer(): void {
    if (this.timerHandle !== undefined) {
      this.scheduler.cancel(this.timerHandle);
      this.timerHandle = undefined;
    }
  }

  /**
   * The synchronous pairing pass: sorts the pool by `enqueuedAt` (FIFO;
   * `failPairing` restores preserve their original timestamp, so true
   * head-of-queue order survives the Map re-insertion above), takes the
   * oldest remaining entry, picks its opponent with the unchanged
   * `selectOpponent` (nearest rating, FIFO tie-break), marks both
   * `resolving`, and repeats until fewer than two entries remain. The
   * leftover odd entry (if any) stays waiting. Re-arms the timer afterward
   * if the (should-be-empty-or-singleton) remainder is somehow still
   * pairable, and hands every pairing produced to the injected `resolver`
   * in one batch.
   *
   * Never called directly except from enqueue() (K-trigger) and the armed
   * timer's callback — both are `runPass`'s only two callers, keeping the
   * "who triggers a pass" decision in exactly those two places.
   */
  private runPass(): Promise<void> {
    const pairings = this.collectPairings();
    this.armTimerIfPairable();

    if (pairings.length === 0) {
      return Promise.resolve();
    }

    // Defense in depth only: the resolver's own contract (see
    // QueueServiceOptions.resolver's doc comment) is to catch everything
    // itself. This swallow exists so that even a resolver that violates
    // that contract can't produce an unhandled rejection out of a timer
    // callback, which would crash the process.
    return Promise.resolve()
      .then(() => this.resolver(pairings))
      .catch(() => undefined);
  }

  private collectPairings(): Pairing[] {
    const pairings: Pairing[] = [];
    let pool = [...this.waiting.values()].sort((a, b) => a.enqueuedAt - b.enqueuedAt);

    while (pool.length >= 2) {
      const first = pool[0]!;
      const opponent = selectOpponent(pool, first.userId, first.rating);
      if (!opponent) break; // defensive; unreachable when pool.length >= 2 (only self can be excluded)

      this.waiting.delete(first.userId);
      this.waiting.delete(opponent.userId);
      this.resolving.add(first.userId);
      this.resolving.add(opponent.userId);

      pairings.push({
        userAId: first.userId,
        buildA: first.build,
        userBId: opponent.userId,
        buildB: opponent.build,
        entryA: first,
        entryB: opponent,
      });

      pool = pool.filter((candidate) => candidate.userId !== first.userId && candidate.userId !== opponent.userId);
    }

    return pairings;
  }
}

export function createQueueService(options: QueueServiceOptions): QueueService {
  return new QueueService(options);
}
