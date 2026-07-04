import { describe, expect, it } from 'vitest';
import { hashEventLog } from './hash.js';
import { EVENT_KINDS, emit, type MatchEvent } from './events.js';

describe('EVENT_KINDS', () => {
  it('has exactly the 11 event kinds', () => {
    expect(EVENT_KINDS).toHaveLength(11);
    expect(new Set(EVENT_KINDS).size).toBe(11);
  });
});

describe('MatchEvent', () => {
  it('typechecks a literal of every event kind', () => {
    const events: MatchEvent[] = [
      {
        kind: 'match-start',
        tick: 0,
        version: 1,
        seed: 42,
        units: [{ id: 0, team: 'A', roleId: 'brawler', pos: { x: 0, y: 0 }, hp: 100, maxHp: 100 }],
      },
      { kind: 'tick', tick: 0 },
      { kind: 'move', tick: 1, unitId: 0, from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
      { kind: 'attack', tick: 2, unitId: 0, targetId: 1 },
      { kind: 'cast', tick: 3, unitId: 0, skillId: 'fireball', targetId: 1 },
      {
        kind: 'damage',
        tick: 3,
        sourceId: 0,
        targetId: 1,
        amount: 10,
        absorbed: 0,
        hpAfter: 90,
      },
      { kind: 'damage', tick: 4, sourceId: null, targetId: 1, amount: 5, absorbed: 0, hpAfter: 85 },
      { kind: 'heal', tick: 5, sourceId: 0, targetId: 0, amount: 10, hpAfter: 100 },
      {
        kind: 'status-applied',
        tick: 6,
        targetId: 1,
        status: 'slow',
        magnitude: 30,
        durationTicks: 40,
      },
      { kind: 'status-expired', tick: 46, targetId: 1, status: 'slow' },
      { kind: 'death', tick: 50, unitId: 1 },
      { kind: 'match-end', tick: 51, winner: 'A' },
    ];

    expect(events).toHaveLength(12);
  });
});

describe('emit', () => {
  it('appends events to the log in order', () => {
    const log: MatchEvent[] = [];

    emit(log, { kind: 'tick', tick: 0 });
    emit(log, { kind: 'tick', tick: 1 });
    emit(log, { kind: 'tick', tick: 2 });

    expect(log).toHaveLength(3);
    expect(log.map((event) => event.tick)).toEqual([0, 1, 2]);
  });
});

describe('hashEventLog with a mixed log', () => {
  it('hashes a log containing several event kinds without throwing', () => {
    const log: MatchEvent[] = [];

    emit(log, {
      kind: 'match-start',
      tick: 0,
      version: 1,
      seed: 42,
      units: [{ id: 0, team: 'A', roleId: 'brawler', pos: { x: 0, y: 0 }, hp: 100, maxHp: 100 }],
    });
    emit(log, { kind: 'move', tick: 1, unitId: 0, from: { x: 0, y: 0 }, to: { x: 1, y: 0 } });
    emit(log, { kind: 'attack', tick: 2, unitId: 0, targetId: 1 });
    emit(log, { kind: 'match-end', tick: 3, winner: 'draw' });

    const hash = hashEventLog(log);

    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThan(2 ** 32);
  });
});
