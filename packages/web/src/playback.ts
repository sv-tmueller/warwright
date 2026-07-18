/**
 * Pure, log-free playback reducer for the match viewer (see the sub-plan on
 * issue #77). State is numbers only: it can never reach the event log, which
 * is how `requestAnimationFrame` driving playback stays unable to mutate any
 * engine or event-log value. The component derives frames separately via
 * `deriveFrame(log, state.tick)`.
 *
 * The sim is authoritative at 20 Hz (`MS_PER_TICK = 1000 / 20`); the
 * displayed tick is `clamp(floor(accumulatorMs / MS_PER_TICK), 0, lastTick)`.
 */

import type { MatchEvent } from '@warwright/core';

export const MS_PER_TICK = 1000 / 20;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

// Extracted verbatim out of MatchViewer (see the sub-plan on issue #59) so
// online-flow.ts can derive the same `lastTick` from a server-resolved
// match's event log without duplicating this one-liner.
export function lastTickOf(log: readonly MatchEvent[]): number {
  const lastEvent = log[log.length - 1];
  return lastEvent ? lastEvent.tick : 0;
}

export type PlaybackStatus = 'playing' | 'paused';

export type PlaybackState = {
  readonly status: PlaybackStatus;
  readonly speed: number;
  readonly tick: number;
  readonly accumulatorMs: number;
  readonly lastTick: number;
};

export type PlaybackAction =
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'setSpeed'; readonly speed: number }
  | { readonly type: 'seek'; readonly tick: number }
  | { readonly type: 'step' }
  | { readonly type: 'advance'; readonly deltaMs: number };

export function createInitialPlaybackState(lastTick: number): PlaybackState {
  return { status: 'paused', speed: 1, tick: 0, accumulatorMs: 0, lastTick };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Both seek and step land on this: setting `tick` always keeps
// `accumulatorMs` consistent with it, so a later `advance` resumes counting
// from exactly where the tick display already is.
function withTick(state: PlaybackState, tick: number): PlaybackState {
  const clampedTick = clamp(tick, 0, state.lastTick);
  return { ...state, tick: clampedTick, accumulatorMs: clampedTick * MS_PER_TICK };
}

export function playback(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case 'play':
      return { ...state, status: 'playing' };
    case 'pause':
      return { ...state, status: 'paused' };
    case 'setSpeed':
      return { ...state, speed: clamp(action.speed, MIN_SPEED, MAX_SPEED) };
    case 'seek':
      return withTick(state, action.tick);
    case 'step':
      return withTick(state, state.tick + 1);
    case 'advance': {
      if (state.status !== 'playing') {
        return state;
      }
      const maxAccumulatorMs = state.lastTick * MS_PER_TICK;
      const accumulatorMs = clamp(
        state.accumulatorMs + action.deltaMs * state.speed,
        0,
        maxAccumulatorMs,
      );
      const tick = clamp(Math.floor(accumulatorMs / MS_PER_TICK), 0, state.lastTick);
      const status = tick >= state.lastTick ? 'paused' : state.status;
      return { ...state, accumulatorMs, tick, status };
    }
    default:
      return state;
  }
}
