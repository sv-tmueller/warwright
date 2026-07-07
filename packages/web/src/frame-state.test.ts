import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '@warwright/core';
import warbandA from '../../../builds/warband-a.json' with { type: 'json' };
import warbandB from '../../../builds/warband-b.json' with { type: 'json' };
import { runClientMatch } from './match-runner.js';
import { deriveFrame, type FrameState, type FrameUnit } from './frame-state.js';

// Small hand-built log covering every persistent and transient event kind,
// used for the targeted per-event assertions below. Mirrors the shapes
// emitted by packages/core/src/sim (see events.ts) but is literal here on
// purpose: this module never recomputes a sim value, it only folds events.
const HAND_BUILT_LOG: MatchEvent[] = [
  {
    kind: 'match-start',
    tick: 0,
    version: 2,
    seed: 1,
    units: [
      { id: 0, team: 'A', roleId: 'vanguard', pos: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
      { id: 1, team: 'B', roleId: 'reaver', pos: { x: 10, y: 10 }, hp: 80, maxHp: 80 },
    ],
  },
  { kind: 'move', tick: 1, unitId: 0, from: { x: 0, y: 0 }, to: { x: 5, y: 0 } },
  { kind: 'tick', tick: 1 },
  { kind: 'attack', tick: 2, unitId: 0, targetId: 1 },
  { kind: 'damage', tick: 2, sourceId: 0, targetId: 1, amount: 20, absorbed: 0, hpAfter: 60 },
  { kind: 'status-applied', tick: 2, targetId: 1, status: 'slow', magnitude: 30, durationTicks: 3 },
  { kind: 'tick', tick: 2 },
  { kind: 'heal', tick: 3, sourceId: 1, targetId: 1, amount: 20, hpAfter: 80 },
  { kind: 'cast', tick: 3, unitId: 0, skillId: 'fireball', targetId: 1 },
  { kind: 'tick', tick: 3 },
  { kind: 'tick', tick: 4 },
  { kind: 'status-expired', tick: 5, targetId: 1, status: 'slow' },
  { kind: 'tick', tick: 5 },
  { kind: 'death', tick: 6, unitId: 1 },
  { kind: 'tick', tick: 6 },
  { kind: 'match-end', tick: 6, winner: 'A' },
];

function unitById(frame: FrameState, id: number): FrameUnit {
  const unit = frame.units.find((candidate) => candidate.id === id);
  if (!unit) throw new Error(`no unit with id ${id} in frame`);
  return unit;
}

describe('deriveFrame: per-event cases (hand-built log)', () => {
  it('seeds units and metadata from match-start at tick 0', () => {
    const frame = deriveFrame(HAND_BUILT_LOG, 0);

    expect(frame.tick).toBe(0);
    expect(frame.version).toBe(2);
    expect(frame.seed).toBe(1);
    expect(frame.winner).toBeNull();
    expect(frame.tickEffects).toEqual([]);

    const unit0 = unitById(frame, 0);
    expect(unit0).toEqual({
      id: 0,
      team: 'A',
      roleId: 'vanguard',
      pos: { x: 0, y: 0 },
      hp: 100,
      maxHp: 100,
      dead: false,
      statuses: {},
    });
  });

  it('move updates pos', () => {
    const frame = deriveFrame(HAND_BUILT_LOG, 1);
    expect(unitById(frame, 0).pos).toEqual({ x: 5, y: 0 });
  });

  it('damage sets hp verbatim from hpAfter and is not derived from amount', () => {
    const frame = deriveFrame(HAND_BUILT_LOG, 2);
    expect(unitById(frame, 1).hp).toBe(60);
  });

  it('collects attack/cast/damage at exactly tick N into tickEffects, in log order', () => {
    const frame = deriveFrame(HAND_BUILT_LOG, 2);
    expect(frame.tickEffects).toEqual([
      { kind: 'attack', tick: 2, unitId: 0, targetId: 1 },
      { kind: 'damage', tick: 2, sourceId: 0, targetId: 1, amount: 20, absorbed: 0, hpAfter: 60 },
    ]);
  });

  it('tickEffects only ever contains events from exactly tick N, not earlier ticks', () => {
    const frame = deriveFrame(HAND_BUILT_LOG, 4);
    expect(frame.tickEffects).toEqual([]);
  });

  it('heal sets the target hp to hpAfter', () => {
    const frame = deriveFrame(HAND_BUILT_LOG, 3);
    expect(unitById(frame, 1).hp).toBe(80);
  });

  it('cast appears in tickEffects at its tick', () => {
    const frame = deriveFrame(HAND_BUILT_LOG, 3);
    expect(frame.tickEffects).toContainEqual({
      kind: 'cast',
      tick: 3,
      unitId: 0,
      skillId: 'fireball',
      targetId: 1,
    });
  });

  it('status-applied sets a status entry keyed by status kind', () => {
    const frame = deriveFrame(HAND_BUILT_LOG, 2);
    expect(unitById(frame, 1).statuses).toEqual({ slow: { magnitude: 30, durationTicks: 3 } });
  });

  it('status-expired removes the status entry (authoritative expiry, no local countdown)', () => {
    const beforeExpiry = deriveFrame(HAND_BUILT_LOG, 4);
    expect(unitById(beforeExpiry, 1).statuses).toEqual({
      slow: { magnitude: 30, durationTicks: 3 },
    });

    const afterExpiry = deriveFrame(HAND_BUILT_LOG, 5);
    expect(unitById(afterExpiry, 1).statuses).toEqual({});
  });

  it('death sets the dead flag', () => {
    const beforeDeath = deriveFrame(HAND_BUILT_LOG, 5);
    expect(unitById(beforeDeath, 1).dead).toBe(false);

    const afterDeath = deriveFrame(HAND_BUILT_LOG, 6);
    expect(unitById(afterDeath, 1).dead).toBe(true);
  });

  it('exposes the winner once match-end has occurred at or before tick N', () => {
    expect(deriveFrame(HAND_BUILT_LOG, 5).winner).toBeNull();
    expect(deriveFrame(HAND_BUILT_LOG, 6).winner).toBe('A');
  });
});

describe('deriveFrame: determinism', () => {
  it('yields an equal FrameState for repeated calls with the same (log, tick)', () => {
    const first = deriveFrame(HAND_BUILT_LOG, 3);
    const second = deriveFrame(HAND_BUILT_LOG, 3);
    expect(first).toEqual(second);
  });
});

// Independent reference model, built by carrying state forward tick by
// tick (rather than deriveFrame's from-scratch fold each call). Comparing
// the two proves "recompute from tick 0" and "carry state forward" agree at
// every tick, the invariant issue #77's tick-seek depends on.
type ReferenceUnit = {
  id: number;
  team: 'A' | 'B';
  roleId: string;
  pos: { x: number; y: number };
  hp: number;
  maxHp: number;
  dead: boolean;
  statuses: Record<string, { magnitude: number; durationTicks: number }>;
};

type ReferenceMeta = {
  version: number | null;
  seed: number | null;
  winner: 'A' | 'B' | 'draw' | null;
};

function applyPersistentEvent(
  units: Map<number, ReferenceUnit>,
  meta: ReferenceMeta,
  event: MatchEvent,
): void {
  switch (event.kind) {
    case 'match-start':
      meta.version = event.version;
      meta.seed = event.seed;
      for (const spawn of event.units) {
        units.set(spawn.id, {
          id: spawn.id,
          team: spawn.team,
          roleId: spawn.roleId,
          pos: spawn.pos,
          hp: spawn.hp,
          maxHp: spawn.maxHp,
          dead: false,
          statuses: {},
        });
      }
      return;
    case 'move': {
      const unit = units.get(event.unitId);
      if (unit) unit.pos = event.to;
      return;
    }
    case 'damage': {
      const unit = units.get(event.targetId);
      if (unit) unit.hp = event.hpAfter;
      return;
    }
    case 'heal': {
      const unit = units.get(event.targetId);
      if (unit) unit.hp = event.hpAfter;
      return;
    }
    case 'status-applied': {
      const unit = units.get(event.targetId);
      if (unit) {
        unit.statuses[event.status] = {
          magnitude: event.magnitude,
          durationTicks: event.durationTicks,
        };
      }
      return;
    }
    case 'status-expired': {
      const unit = units.get(event.targetId);
      if (unit) delete unit.statuses[event.status];
      return;
    }
    case 'death': {
      const unit = units.get(event.unitId);
      if (unit) unit.dead = true;
      return;
    }
    case 'match-end':
      meta.winner = event.winner;
      return;
    case 'tick':
    case 'attack':
    case 'cast':
      return;
    default:
      return;
  }
}

function referenceTickEffects(log: readonly MatchEvent[], tick: number): unknown[] {
  return log.filter(
    (event) =>
      event.tick === tick &&
      (event.kind === 'attack' || event.kind === 'cast' || event.kind === 'damage'),
  );
}

function snapshotReference(
  units: Map<number, ReferenceUnit>,
  meta: ReferenceMeta,
  log: readonly MatchEvent[],
  tick: number,
): FrameState {
  return {
    tick,
    version: meta.version,
    seed: meta.seed,
    winner: meta.winner,
    tickEffects: referenceTickEffects(log, tick) as FrameState['tickEffects'],
    units: Array.from(units.values()).map((unit) => ({ ...unit, statuses: { ...unit.statuses } })),
  };
}

function sortUnitsById(frame: FrameState): FrameState {
  return { ...frame, units: [...frame.units].sort((a, b) => a.id - b.id) };
}

const SEEDS = [1, 7, 42];

describe.each(SEEDS)('deriveFrame: exhaustive tick sweep (seed %d)', (seed) => {
  const { eventLog } = runClientMatch(seed, warbandA, warbandB);
  const lastEvent = eventLog[eventLog.length - 1];
  if (!lastEvent) throw new Error('expected a non-empty event log');
  const endTick = lastEvent.tick;

  it('matches an incrementally accumulated reference model at every tick from 0 to endTick', () => {
    const units = new Map<number, ReferenceUnit>();
    const meta: ReferenceMeta = { version: null, seed: null, winner: null };
    let eventIndex = 0;

    for (let tick = 0; tick <= endTick; tick += 1) {
      while (eventIndex < eventLog.length) {
        const event = eventLog[eventIndex];
        if (!event || event.tick > tick) break;
        applyPersistentEvent(units, meta, event);
        eventIndex += 1;
      }

      const expected = sortUnitsById(snapshotReference(units, meta, eventLog, tick));
      const actual = sortUnitsById(deriveFrame(eventLog, tick));
      expect(actual).toEqual(expected);
    }
  });
});
