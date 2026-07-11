import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '@warwright/core';
import warbandA from '../../../builds/warband-a.json' with { type: 'json' };
import warbandB from '../../../builds/warband-b.json' with { type: 'json' };
import { runClientMatch } from './match-runner.js';
import { createInitialPlaybackState, playback } from './playback.js';
import { buildFeed, feedIndexForTick, formatTickTime, type FeedEntry } from './event-feed.js';

// Small hand-built log covering every feed-eligible event kind plus the
// excluded ones (tick, move), mirroring the shapes emitted by
// packages/core/src/sim (see events.ts) and the convention set by
// frame-state.test.ts's HAND_BUILT_LOG. Real roleIds/skillIds (vanguard,
// reaver, shield-bash) are used so display-name lookups against core's
// `roles`/`skills` data are exercised for real, not just structurally.
const HAND_BUILT_LOG: MatchEvent[] = [
  {
    kind: 'match-start',
    tick: 0,
    version: 2,
    seed: 7,
    units: [
      { id: 0, team: 'A', roleId: 'vanguard', pos: { x: 0, y: 0 }, hp: 200, maxHp: 200 },
      { id: 1, team: 'B', roleId: 'reaver', pos: { x: 10, y: 10 }, hp: 110, maxHp: 110 },
    ],
  },
  { kind: 'move', tick: 1, unitId: 0, from: { x: 0, y: 0 }, to: { x: 5, y: 0 } },
  { kind: 'tick', tick: 1 },
  { kind: 'attack', tick: 2, unitId: 0, targetId: 1 },
  { kind: 'damage', tick: 2, sourceId: 0, targetId: 1, amount: 20, absorbed: 5, hpAfter: 85 },
  { kind: 'status-applied', tick: 2, targetId: 1, status: 'slow', magnitude: 30, durationTicks: 3 },
  { kind: 'tick', tick: 2 },
  { kind: 'heal', tick: 3, sourceId: 1, targetId: 1, amount: 20, hpAfter: 105 },
  { kind: 'cast', tick: 3, unitId: 0, skillId: 'shield-bash', targetId: 1 },
  { kind: 'tick', tick: 3 },
  { kind: 'damage', tick: 4, sourceId: null, targetId: 1, amount: 3, absorbed: 0, hpAfter: 102 },
  { kind: 'tick', tick: 4 },
  { kind: 'status-expired', tick: 5, targetId: 1, status: 'slow' },
  { kind: 'tick', tick: 5 },
  { kind: 'death', tick: 6, unitId: 1 },
  { kind: 'tick', tick: 6 },
  { kind: 'match-end', tick: 6, winner: 'A' },
];

describe('buildFeed: per-event cases (hand-built log)', () => {
  const entries = buildFeed(HAND_BUILT_LOG);

  it('excludes tick and move events entirely', () => {
    expect(entries.some((entry) => entry.kind === 'tick')).toBe(false);
    expect(entries.some((entry) => entry.kind === 'move')).toBe(false);
  });

  it('produces exactly one entry per included event, in log order', () => {
    expect(entries.map((entry) => entry.kind)).toEqual([
      'match-start',
      'attack',
      'damage',
      'status-applied',
      'heal',
      'cast',
      'damage',
      'status-expired',
      'death',
      'match-end',
    ]);
  });

  it('stamps each entry with its event tick', () => {
    expect(entries.map((entry) => entry.tick)).toEqual([0, 2, 2, 2, 3, 3, 4, 5, 6, 6]);
  });

  it('assigns a 0-based index matching each entry\'s position in the array', () => {
    entries.forEach((entry, position) => {
      expect(entry.index).toBe(position);
    });
  });

  it('formats a match-start header line with seed and ruleset version', () => {
    expect(entries[0]?.text).toBe('Match start — seed 7, ruleset v2');
  });

  it('formats an attack line with readable team/role/id unit labels', () => {
    expect(entries[1]?.text).toBe('A·Vanguard#0 attacks B·Reaver#1');
  });

  it('formats a damage line verbatim from the event fields, showing absorbed only when > 0', () => {
    expect(entries[2]?.text).toBe('A·Vanguard#0 hits B·Reaver#1 for 20 (5 absorbed), hp 85');
  });

  it('formats a status-applied line with magnitude and duration', () => {
    expect(entries[3]?.text).toBe('B·Reaver#1 gains slow (magnitude 30, 3 ticks)');
  });

  it('formats a heal line', () => {
    expect(entries[4]?.text).toBe('B·Reaver#1 heals B·Reaver#1 for 20, hp 105');
  });

  it('formats a cast line with the skill\'s display name, not its id', () => {
    expect(entries[5]?.text).toBe('A·Vanguard#0 casts Shield Bash on B·Reaver#1');
  });

  it('formats a sourceless (dot) damage line without an attacker label', () => {
    expect(entries[6]?.text).toBe('B·Reaver#1 takes 3 damage over time, hp 102');
  });

  it('formats a status-expired line', () => {
    expect(entries[7]?.text).toBe('B·Reaver#1 loses slow');
  });

  it('formats a death line', () => {
    expect(entries[8]?.text).toBe('B·Reaver#1 dies');
  });

  it('formats a match-end line with the winner', () => {
    expect(entries[9]?.text).toBe('Match ends — winner: A');
  });
});

describe('buildFeed: real log', () => {
  const SEED = 42;
  const { eventLog } = runClientMatch(SEED, warbandA, warbandB);

  it('produces entries with non-decreasing ticks within [0, lastTick]', () => {
    const entries = buildFeed(eventLog);
    const lastEvent = eventLog[eventLog.length - 1];
    if (!lastEvent) throw new Error('expected a non-empty event log');

    for (const entry of entries) {
      expect(entry.tick).toBeGreaterThanOrEqual(0);
      expect(entry.tick).toBeLessThanOrEqual(lastEvent.tick);
    }
    for (let i = 1; i < entries.length; i += 1) {
      const previous = entries[i - 1];
      const current = entries[i];
      if (previous && current) {
        expect(current.tick).toBeGreaterThanOrEqual(previous.tick);
      }
    }
  });

  it('is deterministic across repeated calls with the same log', () => {
    const first = buildFeed(eventLog);
    const second = buildFeed(eventLog);
    expect(first).toEqual(second);
  });
});

describe('feedIndexForTick', () => {
  const entries = buildFeed(HAND_BUILT_LOG);

  it('returns -1 before the first entry', () => {
    expect(feedIndexForTick(entries, -1)).toBe(-1);
  });

  it('returns the index of the entry exactly at the given tick', () => {
    // tick 6 has both a death and a match-end entry; the last one at or
    // before the target tick wins.
    expect(feedIndexForTick(entries, 6)).toBe(entries.length - 1);
  });

  it('returns the previous entry\'s index for a tick with no feed events of its own', () => {
    // tick 1 only has a move event, which is excluded from the feed; the
    // most recent prior entry (match-start at tick 0) should be highlighted.
    expect(feedIndexForTick(entries, 1)).toBe(0);
  });

  it('returns the last entry\'s index for a tick beyond the last entry', () => {
    expect(feedIndexForTick(entries, 999)).toBe(entries.length - 1);
  });
});

describe('feedIndexForTick: exact-seek sync (batch #89 contract)', () => {
  const SEED = 42;
  const { eventLog } = runClientMatch(SEED, warbandA, warbandB);
  const entries = buildFeed(eventLog);
  const lastEvent = eventLog[eventLog.length - 1];
  if (!lastEvent) throw new Error('expected a non-empty event log');
  const lastTick = lastEvent.tick;
  const mid = Math.floor(lastTick / 2);

  function tickByStepping(target: number): number {
    let state = createInitialPlaybackState(lastTick);
    for (let i = 0; i < target; i += 1) {
      state = playback(state, { type: 'step' });
    }
    return state.tick;
  }

  function assertBracket(entries: readonly FeedEntry[], index: number, target: number): void {
    if (index === -1) {
      expect(entries.every((entry) => entry.tick > target)).toBe(true);
      return;
    }
    const entry = entries[index];
    expect(entry?.tick).toBeLessThanOrEqual(target);
    const next = entries[index + 1];
    if (next) {
      expect(next.tick).toBeGreaterThan(target);
    }
  }

  it.each([0, mid, lastTick, lastTick + 5])(
    'seek(%d) lands on the same feed index as stepping there tick by tick, with a correct bracket',
    (target) => {
      const seeked = playback(createInitialPlaybackState(lastTick), { type: 'seek', tick: target });
      const steppedTick = tickByStepping(target);
      expect(seeked.tick).toBe(steppedTick);

      const seekedIndex = feedIndexForTick(entries, seeked.tick);
      const steppedIndex = feedIndexForTick(entries, steppedTick);
      expect(seekedIndex).toBe(steppedIndex);

      assertBracket(entries, seekedIndex, seeked.tick);
    },
  );
});

describe('formatTickTime', () => {
  it('formats tick 0', () => {
    expect(formatTickTime(0)).toBe('t 0 · 0.00s');
  });

  it('formats a non-round tick', () => {
    expect(formatTickTime(137)).toBe('t 137 · 6.85s');
  });

  it('formats an exact 20 Hz conversion', () => {
    expect(formatTickTime(20)).toBe('t 20 · 1.00s');
  });
});
