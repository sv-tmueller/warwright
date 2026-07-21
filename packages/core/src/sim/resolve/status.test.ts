import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../events.js';
import type { Unit } from '../types.js';
import { applyStatus, tickStatuses } from './status.js';

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 0,
    team: 'A',
    roleId: 'brawler',
    behaviorId: 'idle',
    maxHp: 100,
    hp: 100,
    armor: 0,
    moveSpeed: 1,
    attackDamage: 10,
    attackRangeSquared: 1,
    attackCooldownTicks: 10,
    attackCooldownRemaining: 0,
    pos: { x: 5, y: 5 },
    skills: [],
    slow: null,
    shield: null,
    stun: null,
    empower: null,
    activeDots: [],
    ...overrides,
  };
}

describe('applyStatus', () => {
  it('sets slow when none is active', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];

    applyStatus(unit, 'slow', 40, 30, log, 6);

    expect(unit.slow).toEqual({ magnitude: 30, remainingTicks: 40 });
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual({
      kind: 'status-applied',
      tick: 6,
      targetId: unit.id,
      status: 'slow',
      magnitude: 30,
      durationTicks: 40,
    });
  });

  it('replaces an existing slow on re-apply', () => {
    const unit = makeUnit({ slow: { magnitude: 20, remainingTicks: 5 } });
    const log: MatchEvent[] = [];

    applyStatus(unit, 'slow', 40, 30, log, 6);

    expect(unit.slow).toEqual({ magnitude: 30, remainingTicks: 40 });
  });

  it('sets shield when none is active', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];

    applyStatus(unit, 'shield', 10, 50, log, 1);

    expect(unit.shield).toEqual({ magnitude: 50, remainingTicks: 10 });
    expect(log[0]).toEqual({
      kind: 'status-applied',
      tick: 1,
      targetId: unit.id,
      status: 'shield',
      magnitude: 50,
      durationTicks: 10,
    });
  });

  it('adds magnitude to an existing shield pool and refreshes the timer', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];

    applyStatus(unit, 'shield', 10, 50, log, 1);
    applyStatus(unit, 'shield', 3, 20, log, 2);

    expect(unit.shield).toEqual({ magnitude: 70, remainingTicks: 3 });
    expect(log).toHaveLength(2);
    expect(log[1]).toEqual({
      kind: 'status-applied',
      tick: 2,
      targetId: unit.id,
      status: 'shield',
      magnitude: 20,
      durationTicks: 3,
    });
  });

  it('appends a new independent entry for dots', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];

    applyStatus(unit, 'dot', 3, 5, log, 1);
    applyStatus(unit, 'dot', 4, 7, log, 2);

    expect(unit.activeDots).toEqual([
      { damagePerTick: 5, remainingTicks: 3 },
      { damagePerTick: 7, remainingTicks: 4 },
    ]);
    expect(log[0]).toEqual({
      kind: 'status-applied',
      tick: 1,
      targetId: unit.id,
      status: 'dot',
      magnitude: 5,
      durationTicks: 3,
    });
    expect(log[1]).toEqual({
      kind: 'status-applied',
      tick: 2,
      targetId: unit.id,
      status: 'dot',
      magnitude: 7,
      durationTicks: 4,
    });
  });

  it('never touches pos', () => {
    const unit = makeUnit();
    const posBefore = { ...unit.pos };

    applyStatus(unit, 'slow', 40, 30, [], 1);

    expect(unit.pos).toEqual(posBefore);
  });

  it('sets stun when none is active', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];

    applyStatus(unit, 'stun', 20, 0, log, 3);

    expect(unit.stun).toEqual({ magnitude: 0, remainingTicks: 20 });
    expect(log[0]).toEqual({
      kind: 'status-applied',
      tick: 3,
      targetId: unit.id,
      status: 'stun',
      magnitude: 0,
      durationTicks: 20,
    });
  });

  it('overwrites an existing stun on re-apply (single-slot, last write wins)', () => {
    const unit = makeUnit({ stun: { magnitude: 0, remainingTicks: 5 } });
    const log: MatchEvent[] = [];

    applyStatus(unit, 'stun', 20, 0, log, 3);

    expect(unit.stun).toEqual({ magnitude: 0, remainingTicks: 20 });
  });

  it('sets empower when none is active', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];

    applyStatus(unit, 'empower', 30, 25, log, 4);

    expect(unit.empower).toEqual({ magnitude: 25, remainingTicks: 30 });
    expect(log[0]).toEqual({
      kind: 'status-applied',
      tick: 4,
      targetId: unit.id,
      status: 'empower',
      magnitude: 25,
      durationTicks: 30,
    });
  });

  it('overwrites an existing empower on re-apply (single-slot, last write wins)', () => {
    const unit = makeUnit({ empower: { magnitude: 10, remainingTicks: 5 } });
    const log: MatchEvent[] = [];

    applyStatus(unit, 'empower', 30, 25, log, 4);

    expect(unit.empower).toEqual({ magnitude: 25, remainingTicks: 30 });
  });
});

describe('tickStatuses', () => {
  it('decrements slow without expiring before remainingTicks hits 0', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];
    applyStatus(unit, 'slow', 2, 30, log, 0);
    log.length = 0;

    tickStatuses(unit, log, 1);

    expect(unit.slow).toEqual({ magnitude: 30, remainingTicks: 1 });
    expect(log).toHaveLength(0);
  });

  it('expires slow and emits status-expired when remainingTicks reaches 0', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];
    applyStatus(unit, 'slow', 2, 30, log, 0);
    log.length = 0;

    tickStatuses(unit, log, 1);
    tickStatuses(unit, log, 2);

    expect(unit.slow).toBeNull();
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual({ kind: 'status-expired', tick: 2, targetId: unit.id, status: 'slow' });
  });

  it('expires shield when the absorb pool is depleted to 0', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];
    applyStatus(unit, 'shield', 10, 50, log, 0);
    log.length = 0;

    // Combat consuming the pool: this module deals no damage itself.
    unit.shield!.magnitude = 0;
    tickStatuses(unit, log, 1);

    expect(unit.shield).toBeNull();
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual({
      kind: 'status-expired',
      tick: 1,
      targetId: unit.id,
      status: 'shield',
    });
  });

  it('expires shield when the timer runs out even with pool remaining', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];
    applyStatus(unit, 'shield', 2, 50, log, 0);
    log.length = 0;

    tickStatuses(unit, log, 1);
    tickStatuses(unit, log, 2);

    expect(unit.shield).toBeNull();
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual({
      kind: 'status-expired',
      tick: 2,
      targetId: unit.id,
      status: 'shield',
    });
  });

  it('decrements stun without expiring before remainingTicks hits 0', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];
    applyStatus(unit, 'stun', 2, 0, log, 0);
    log.length = 0;

    tickStatuses(unit, log, 1);

    expect(unit.stun).toEqual({ magnitude: 0, remainingTicks: 1 });
    expect(log).toHaveLength(0);
  });

  it('expires stun and emits status-expired when remainingTicks reaches 0', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];
    applyStatus(unit, 'stun', 2, 0, log, 0);
    log.length = 0;

    tickStatuses(unit, log, 1);
    tickStatuses(unit, log, 2);

    expect(unit.stun).toBeNull();
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual({ kind: 'status-expired', tick: 2, targetId: unit.id, status: 'stun' });
  });

  it('decrements empower without expiring before remainingTicks hits 0', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];
    applyStatus(unit, 'empower', 2, 25, log, 0);
    log.length = 0;

    tickStatuses(unit, log, 1);

    expect(unit.empower).toEqual({ magnitude: 25, remainingTicks: 1 });
    expect(log).toHaveLength(0);
  });

  it('expires empower and emits status-expired when remainingTicks reaches 0', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];
    applyStatus(unit, 'empower', 2, 25, log, 0);
    log.length = 0;

    tickStatuses(unit, log, 1);
    tickStatuses(unit, log, 2);

    expect(unit.empower).toBeNull();
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual({
      kind: 'status-expired',
      tick: 2,
      targetId: unit.id,
      status: 'empower',
    });
  });

  it('survives dots for exactly N ticks then removes them, leaving hp untouched', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];
    applyStatus(unit, 'dot', 3, 5, log, 0);
    log.length = 0;
    const hpBefore = unit.hp;

    tickStatuses(unit, log, 1);
    expect(unit.activeDots).toEqual([{ damagePerTick: 5, remainingTicks: 2 }]);
    expect(log).toHaveLength(0);

    tickStatuses(unit, log, 2);
    expect(unit.activeDots).toEqual([{ damagePerTick: 5, remainingTicks: 1 }]);
    expect(log).toHaveLength(0);

    tickStatuses(unit, log, 3);
    expect(unit.activeDots).toEqual([]);
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual({ kind: 'status-expired', tick: 3, targetId: unit.id, status: 'dot' });

    expect(unit.hp).toBe(hpBefore);
  });

  it('expires slow, shield, stun, empower, then dots in array order on the same tick', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];
    applyStatus(unit, 'slow', 1, 30, log, 0);
    applyStatus(unit, 'shield', 1, 50, log, 0);
    applyStatus(unit, 'stun', 1, 0, log, 0);
    applyStatus(unit, 'empower', 1, 25, log, 0);
    applyStatus(unit, 'dot', 1, 5, log, 0);
    applyStatus(unit, 'dot', 1, 7, log, 0);
    log.length = 0;

    tickStatuses(unit, log, 1);

    expect(log).toEqual([
      { kind: 'status-expired', tick: 1, targetId: unit.id, status: 'slow' },
      { kind: 'status-expired', tick: 1, targetId: unit.id, status: 'shield' },
      { kind: 'status-expired', tick: 1, targetId: unit.id, status: 'stun' },
      { kind: 'status-expired', tick: 1, targetId: unit.id, status: 'empower' },
      { kind: 'status-expired', tick: 1, targetId: unit.id, status: 'dot' },
      { kind: 'status-expired', tick: 1, targetId: unit.id, status: 'dot' },
    ]);
  });

  it('never touches pos', () => {
    const unit = makeUnit();
    const log: MatchEvent[] = [];
    applyStatus(unit, 'slow', 2, 30, log, 0);
    applyStatus(unit, 'shield', 2, 50, log, 0);
    applyStatus(unit, 'dot', 2, 5, log, 0);
    const posBefore = { ...unit.pos };

    tickStatuses(unit, log, 1);
    tickStatuses(unit, log, 2);

    expect(unit.pos).toEqual(posBefore);
  });
});
