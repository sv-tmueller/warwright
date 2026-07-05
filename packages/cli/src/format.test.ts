import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '@warwright/core';
import { formatEventLog } from './format.js';

describe('formatEventLog', () => {
  it('emits one line per event kind except tick, which emits no line', () => {
    const fixture: MatchEvent[] = [
      {
        kind: 'match-start',
        tick: 0,
        version: 1,
        seed: 42,
        units: [
          { id: 1, team: 'A', roleId: 'vanguard', pos: { x: 100, y: 400 }, hp: 120, maxHp: 120 },
          { id: 2, team: 'B', roleId: 'reaver', pos: { x: 900, y: 400 }, hp: 90, maxHp: 90 },
        ],
      },
      { kind: 'tick', tick: 1 },
      { kind: 'move', tick: 2, unitId: 1, from: { x: 100, y: 400 }, to: { x: 105, y: 400 } },
      { kind: 'attack', tick: 2, unitId: 1, targetId: 2 },
      { kind: 'cast', tick: 3, unitId: 1, skillId: 'shield-bash', targetId: 2 },
      // a bare tick with nothing else that tick: locks the skip rule
      { kind: 'tick', tick: 4 },
      { kind: 'damage', tick: 5, sourceId: 1, targetId: 2, amount: 10, absorbed: 0, hpAfter: 80 },
      { kind: 'damage', tick: 6, sourceId: null, targetId: 2, amount: 3, absorbed: 0, hpAfter: 77 },
      { kind: 'heal', tick: 7, sourceId: 1, targetId: 2, amount: 5, hpAfter: 82 },
      { kind: 'status-applied', tick: 8, targetId: 2, status: 'slow', magnitude: 20, durationTicks: 40 },
      { kind: 'status-expired', tick: 9, targetId: 2, status: 'slow' },
      { kind: 'death', tick: 10, unitId: 2 },
      { kind: 'match-end', tick: 11, winner: 'A' },
    ];

    expect(formatEventLog(fixture)).toEqual([
      't0 match-start version=1 seed=42 units=2',
      't2 move unit=1 from=(100,400) to=(105,400)',
      't2 attack unit=1 -> target=2',
      't3 cast unit=1 skill=shield-bash -> target=2',
      't5 damage source=1 -> target=2 amount=10 absorbed=0 hp=80',
      't6 damage source=dot -> target=2 amount=3 absorbed=0 hp=77',
      't7 heal source=1 -> target=2 amount=5 hp=82',
      't8 status-applied target=2 status=slow magnitude=20 duration=40',
      't9 status-expired target=2 status=slow',
      't10 death unit=2',
      't11 match-end winner=A',
    ]);
  });
});
