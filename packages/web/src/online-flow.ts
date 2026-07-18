import { RULESET_VERSION, type MatchEvent } from '@warwright/core';
import {
  ALREADY_QUEUED_ERROR,
  type ApiResult,
  type EnqueueOutcome,
  type MatchResultEnvelope,
  type QueueStatus,
} from './api-client.js';
import { lastTickOf } from './playback.js';

// Pure interpretation of the queue's server responses into what
// OnlineMode.tsx should do next (see the sub-plan on issue #59). Contains
// no fetch/timer/DOM access, so it's fully unit-testable; the thin
// component owns the actual setTimeout polling loop and never rAF (per
// CLAUDE.md, requestAnimationFrame drives rendering only).

// Props for the existing, standalone `MatchPlayback` component (untouched
// by this issue): server carries no build names, so both sides are labeled
// generically.
export type PlaybackProps = {
  readonly log: readonly MatchEvent[];
  readonly lastTick: number;
  readonly buildAName: string;
  readonly buildBName: string;
};

const SIDE_A_LABEL = 'Side A';
const SIDE_B_LABEL = 'Side B';

type PlaybackResult = { readonly ok: true; readonly value: PlaybackProps } | { readonly ok: false; readonly error: string };

/**
 * Converts a validated server MatchResult into `MatchPlayback` props.
 * Refuses loudly (never compares/plays across ruleset versions) if the
 * result's version doesn't match this client's compiled-in RULESET_VERSION
 * — see CLAUDE.md's determinism contract. `eventLog` is passed through by
 * reference, UNMODIFIED: this function never maps, filters, or clones it,
 * which is what makes reference-equality in online-flow.test.ts a valid
 * "never resolves locally" proof.
 */
export function toPlaybackProps(result: MatchResultEnvelope): PlaybackResult {
  if (result.version !== RULESET_VERSION) {
    return {
      ok: false,
      error: `Match was resolved on ruleset version ${result.version}, but this client is running version ${RULESET_VERSION}. Refusing to replay a mismatched ruleset.`,
    };
  }

  return {
    ok: true,
    value: {
      log: result.eventLog,
      lastTick: lastTickOf(result.eventLog),
      buildAName: SIDE_A_LABEL,
      buildBName: SIDE_B_LABEL,
    },
  };
}

export type QueueAction =
  | { readonly type: 'wait' }
  | { readonly type: 'idle' }
  | { readonly type: 'matched'; readonly matchId: string; readonly playback: PlaybackProps }
  | { readonly type: 'error'; readonly message: string };

function toMatchedAction(matchId: string, result: MatchResultEnvelope): QueueAction {
  const playback = toPlaybackProps(result);
  return playback.ok
    ? { type: 'matched', matchId, playback: playback.value }
    : { type: 'error', message: playback.error };
}

/** Interprets a GET /queue status (idle / waiting / matched) as an action. */
export function interpretQueueStatus(result: ApiResult<QueueStatus>): QueueAction {
  if (!result.ok) {
    return { type: 'error', message: result.error };
  }
  const status = result.value;
  if (status.status === 'matched') {
    return toMatchedAction(status.matchId, status.result);
  }
  if (status.status === 'waiting') {
    return { type: 'wait' };
  }
  return { type: 'idle' };
}

/**
 * Interprets a POST /queue (Join) response as an action. A 409 'Already
 * queued' resumes polling rather than surfacing as a hard error: it covers
 * a mid-queue page reload racing an already-active queue entry (see the
 * sub-plan on issue #59).
 */
export function interpretEnqueueResult(result: ApiResult<EnqueueOutcome>): QueueAction {
  if (!result.ok) {
    return result.error === ALREADY_QUEUED_ERROR ? { type: 'wait' } : { type: 'error', message: result.error };
  }
  const outcome = result.value;
  return outcome.status === 'matched' ? toMatchedAction(outcome.matchId, outcome.result) : { type: 'wait' };
}
