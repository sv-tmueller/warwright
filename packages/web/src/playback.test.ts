import { describe, expect, it } from 'vitest';
import warbandA from '../../../builds/warband-a.json' with { type: 'json' };
import warbandB from '../../../builds/warband-b.json' with { type: 'json' };
import { runClientMatch } from './match-runner.js';
import { deriveFrame } from './frame-state.js';
import {
  createInitialPlaybackState,
  playback,
  MS_PER_TICK,
  MIN_SPEED,
  MAX_SPEED,
} from './playback.js';

const LAST_TICK = 10;

function initial(lastTick = LAST_TICK) {
  return createInitialPlaybackState(lastTick);
}

describe('createInitialPlaybackState', () => {
  it('starts paused at tick 0 with speed 1 and no accumulated time', () => {
    expect(initial()).toEqual({
      status: 'paused',
      speed: 1,
      tick: 0,
      accumulatorMs: 0,
      lastTick: LAST_TICK,
    });
  });
});

describe('playback: play/pause transitions', () => {
  it('play sets status to playing', () => {
    const state = playback(initial(), { type: 'play' });
    expect(state.status).toBe('playing');
  });

  it('pause sets status to paused', () => {
    const playing = playback(initial(), { type: 'play' });
    const state = playback(playing, { type: 'pause' });
    expect(state.status).toBe('paused');
  });
});

describe('playback: setSpeed', () => {
  it('sets speed to the requested value within range', () => {
    const state = playback(initial(), { type: 'setSpeed', speed: 2 });
    expect(state.speed).toBe(2);
  });

  it('clamps speed below the minimum', () => {
    const state = playback(initial(), { type: 'setSpeed', speed: 0 });
    expect(state.speed).toBe(MIN_SPEED);
  });

  it('clamps speed above the maximum', () => {
    const state = playback(initial(), { type: 'setSpeed', speed: 100 });
    expect(state.speed).toBe(MAX_SPEED);
  });
});

describe('playback: seek', () => {
  it('sets tick to the requested value', () => {
    const state = playback(initial(), { type: 'seek', tick: 4 });
    expect(state.tick).toBe(4);
  });

  it('sets accumulatorMs consistently with the new tick', () => {
    const state = playback(initial(), { type: 'seek', tick: 4 });
    expect(state.accumulatorMs).toBe(4 * MS_PER_TICK);
  });

  it('clamps a negative seek to 0', () => {
    const state = playback(initial(), { type: 'seek', tick: -3 });
    expect(state.tick).toBe(0);
  });

  it('clamps a seek beyond lastTick to lastTick', () => {
    const state = playback(initial(), { type: 'seek', tick: LAST_TICK + 5 });
    expect(state.tick).toBe(LAST_TICK);
  });
});

describe('playback: step', () => {
  it('advances tick by exactly 1', () => {
    const state = playback(initial(), { type: 'step' });
    expect(state.tick).toBe(1);
  });

  it('clamps at lastTick and does not go beyond it', () => {
    let state = initial();
    for (let i = 0; i < LAST_TICK + 5; i += 1) {
      state = playback(state, { type: 'step' });
    }
    expect(state.tick).toBe(LAST_TICK);
  });
});

describe('playback: advance accumulation', () => {
  it('does nothing while paused', () => {
    const state = playback(initial(), { type: 'advance', deltaMs: 1000 });
    expect(state.tick).toBe(0);
    expect(state.accumulatorMs).toBe(0);
  });

  it('accumulates deltaMs at speed 1 and derives tick from MS_PER_TICK', () => {
    const playing = playback(initial(), { type: 'play' });
    const state = playback(playing, { type: 'advance', deltaMs: MS_PER_TICK * 2.5 });
    expect(state.accumulatorMs).toBe(MS_PER_TICK * 2.5);
    expect(state.tick).toBe(2);
  });

  it('scales deltaMs by speed', () => {
    let state = playback(initial(), { type: 'play' });
    state = playback(state, { type: 'setSpeed', speed: 2 });
    state = playback(state, { type: 'advance', deltaMs: MS_PER_TICK });
    expect(state.accumulatorMs).toBe(MS_PER_TICK * 2);
    expect(state.tick).toBe(2);
  });

  it('accumulates across multiple advance calls', () => {
    let state = playback(initial(), { type: 'play' });
    state = playback(state, { type: 'advance', deltaMs: MS_PER_TICK });
    state = playback(state, { type: 'advance', deltaMs: MS_PER_TICK });
    state = playback(state, { type: 'advance', deltaMs: MS_PER_TICK });
    expect(state.accumulatorMs).toBe(MS_PER_TICK * 3);
    expect(state.tick).toBe(3);
  });
});

describe('playback: auto-pause at lastTick', () => {
  it('pauses once advance carries the tick to lastTick', () => {
    const playing = playback(initial(), { type: 'play' });
    const state = playback(playing, {
      type: 'advance',
      deltaMs: MS_PER_TICK * LAST_TICK,
    });
    expect(state.tick).toBe(LAST_TICK);
    expect(state.status).toBe('paused');
  });

  it('clamps accumulatorMs and tick when advance overshoots lastTick', () => {
    const playing = playback(initial(), { type: 'play' });
    const state = playback(playing, {
      type: 'advance',
      deltaMs: MS_PER_TICK * (LAST_TICK + 50),
    });
    expect(state.tick).toBe(LAST_TICK);
    expect(state.accumulatorMs).toBe(LAST_TICK * MS_PER_TICK);
    expect(state.status).toBe('paused');
  });

  it('does not auto-pause before the tick reaches lastTick', () => {
    const playing = playback(initial(), { type: 'play' });
    const state = playback(playing, { type: 'advance', deltaMs: MS_PER_TICK });
    expect(state.status).toBe('playing');
  });
});

describe('playback: exact seek over a real match log', () => {
  const SEED = 42;
  const { eventLog } = runClientMatch(SEED, warbandA, warbandB);
  const lastEvent = eventLog[eventLog.length - 1];
  if (!lastEvent) throw new Error('expected a non-empty event log');
  const lastTick = lastEvent.tick;
  const mid = Math.floor(lastTick / 2);

  function tickByStepping(target: number): number {
    let state = initial(lastTick);
    for (let i = 0; i < target; i += 1) {
      state = playback(state, { type: 'step' });
    }
    return state.tick;
  }

  it.each([0, mid, lastTick, lastTick + 5])(
    'seek(%d) lands on the same tick and derived frame as stepping from 0',
    (target) => {
      const seeked = playback(initial(lastTick), { type: 'seek', tick: target });
      const steppedTick = tickByStepping(target);

      expect(seeked.tick).toBe(steppedTick);
      expect(deriveFrame(eventLog, seeked.tick)).toEqual(deriveFrame(eventLog, steppedTick));
    },
  );
});
