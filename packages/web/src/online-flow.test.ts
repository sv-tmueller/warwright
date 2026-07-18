import { describe, expect, it } from 'vitest';
import { RULESET_VERSION, type MatchEvent } from '@warwright/core';
import { ALREADY_QUEUED_ERROR, type MatchResultEnvelope } from './api-client.js';
import { interpretEnqueueResult, interpretQueueStatus, toPlaybackProps } from './online-flow.js';

function matchResult(overrides: Partial<MatchResultEnvelope> = {}): MatchResultEnvelope {
  const eventLog: MatchEvent[] = [{ kind: 'tick', tick: 0 }, { kind: 'tick', tick: 9 }];
  return {
    version: RULESET_VERSION,
    seed: 42,
    hash: 123,
    winner: 'A',
    eventLog,
    ...overrides,
  };
}

describe('toPlaybackProps', () => {
  it('converts a matching-version result to MatchPlayback props, deriving lastTick', () => {
    const result = matchResult();

    const converted = toPlaybackProps(result);

    expect(converted).toEqual({
      ok: true,
      value: {
        log: result.eventLog,
        lastTick: 9,
        buildAName: 'Side A',
        buildBName: 'Side B',
      },
    });
  });

  it('passes the eventLog through UNMODIFIED, by reference (never-resolves-locally proof)', () => {
    const result = matchResult();

    const converted = toPlaybackProps(result);

    expect(converted.ok).toBe(true);
    if (converted.ok) {
      // Reference equality, not just deep equality: proves online-flow.ts
      // forwards the array the server sent rather than recomputing or
      // cloning it locally (see the sub-plan's "no local recompute
      // possible" note on issue #59).
      expect(converted.value.log).toBe(result.eventLog);
    }
  });

  it('refuses loudly when the result ruleset version does not match RULESET_VERSION', () => {
    const result = matchResult({ version: RULESET_VERSION + 1 });

    const converted = toPlaybackProps(result);

    expect(converted.ok).toBe(false);
    if (!converted.ok) {
      expect(converted.error).toMatch(/version/i);
    }
  });

  it('derives lastTick 0 for an empty event log', () => {
    const result = matchResult({ eventLog: [] });

    const converted = toPlaybackProps(result);

    expect(converted).toEqual({
      ok: true,
      value: { log: [], lastTick: 0, buildAName: 'Side A', buildBName: 'Side B' },
    });
  });
});

describe('interpretQueueStatus', () => {
  it('202/waiting -> a wait action (keep polling)', () => {
    const action = interpretQueueStatus({ ok: true, value: { status: 'waiting' } });
    expect(action).toEqual({ type: 'wait' });
  });

  it('idle -> an idle action', () => {
    const action = interpretQueueStatus({ ok: true, value: { status: 'idle' } });
    expect(action).toEqual({ type: 'idle' });
  });

  it('matched -> a matched action carrying matchId and converted playback props', () => {
    const result = matchResult();

    const action = interpretQueueStatus({
      ok: true,
      value: { status: 'matched', matchId: 'm1', result },
    });

    expect(action.type).toBe('matched');
    if (action.type === 'matched') {
      expect(action.matchId).toBe('m1');
      expect(action.playback.log).toBe(result.eventLog);
      expect(action.playback.lastTick).toBe(9);
    }
  });

  it('matched with a mismatched ruleset version -> an error action, not a playback attempt', () => {
    const result = matchResult({ version: RULESET_VERSION + 1 });

    const action = interpretQueueStatus({
      ok: true,
      value: { status: 'matched', matchId: 'm1', result },
    });

    expect(action.type).toBe('error');
  });

  it('an api-client failure -> an error action carrying the message', () => {
    const action = interpretQueueStatus({ ok: false, error: 'Network error: boom' });
    expect(action).toEqual({ type: 'error', message: 'Network error: boom' });
  });
});

describe('interpretEnqueueResult', () => {
  it('waiting (202) -> a wait action', () => {
    const action = interpretEnqueueResult({ ok: true, value: { status: 'waiting' } });
    expect(action).toEqual({ type: 'wait' });
  });

  it('matched (200) -> a matched action', () => {
    const result = matchResult();
    const action = interpretEnqueueResult({
      ok: true,
      value: { status: 'matched', matchId: 'm1', result },
    });
    expect(action.type).toBe('matched');
  });

  // The never-resolves-locally proof at the join boundary too: a mid-queue
  // reload's Join can race an already-active queue entry, and a 409
  // 'Already queued' from the server must resume polling rather than
  // surfacing as a hard error (see the sub-plan on issue #59).
  it('409 Already queued on Join -> resumes polling (a wait action, not an error)', () => {
    const action = interpretEnqueueResult({ ok: false, error: ALREADY_QUEUED_ERROR });
    expect(action).toEqual({ type: 'wait' });
  });

  it('any other error -> an error action carrying the message', () => {
    const action = interpretEnqueueResult({ ok: false, error: 'Warband not found' });
    expect(action).toEqual({ type: 'error', message: 'Warband not found' });
  });
});
