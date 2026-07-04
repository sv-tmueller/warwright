import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../events.js';
import type { Unit } from '../types.js';
import { moveUnitToward } from './movement.js';

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 1,
    team: 'A',
    roleId: 'test-role',
    behaviorId: 'test-behavior',
    maxHp: 100,
    hp: 100,
    armor: 0,
    moveSpeed: 10,
    attackDamage: 0,
    attackRangeSquared: 0,
    attackCooldownTicks: 0,
    attackCooldownRemaining: 0,
    pos: { x: 0, y: 0 },
    skills: [],
    slow: null,
    shield: null,
    activeDots: [],
    ...overrides,
  };
}

describe('moveUnitToward', () => {
  it('moves at full speed and emits a move event when unslowed', () => {
    const unit = makeUnit({ moveSpeed: 10, pos: { x: 0, y: 0 } });
    const log: MatchEvent[] = [];

    moveUnitToward(unit, { x: 100, y: 0 }, log, 5);

    expect(unit.pos).toEqual({ x: 10, y: 0 });
    expect(log).toEqual([
      { kind: 'move', tick: 5, unitId: 1, from: { x: 0, y: 0 }, to: { x: 10, y: 0 } },
    ]);
  });

  it('scales down the step for a slowed unit', () => {
    const unit = makeUnit({
      moveSpeed: 10,
      pos: { x: 0, y: 0 },
      slow: { magnitude: 30, remainingTicks: 40 },
    });
    const log: MatchEvent[] = [];

    moveUnitToward(unit, { x: 100, y: 0 }, log, 5);

    expect(unit.pos).toEqual({ x: 7, y: 0 });
    expect(log).toEqual([
      { kind: 'move', tick: 5, unitId: 1, from: { x: 0, y: 0 }, to: { x: 7, y: 0 } },
    ]);
  });

  it('does not move or emit when fully slowed', () => {
    const unit = makeUnit({
      moveSpeed: 10,
      pos: { x: 0, y: 0 },
      slow: { magnitude: 100, remainingTicks: 40 },
    });
    const log: MatchEvent[] = [];

    moveUnitToward(unit, { x: 100, y: 0 }, log, 5);

    expect(unit.pos).toEqual({ x: 0, y: 0 });
    expect(log).toEqual([]);
  });

  it('emits a from/to snapshot unaffected by later mutation of unit.pos', () => {
    const unit = makeUnit({ moveSpeed: 10, pos: { x: 0, y: 0 } });
    const log: MatchEvent[] = [];

    moveUnitToward(unit, { x: 100, y: 0 }, log, 5);
    unit.pos.x = 999;
    unit.pos.y = 999;

    expect(log[0]).toEqual({
      kind: 'move',
      tick: 5,
      unitId: 1,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
    });
  });
});
