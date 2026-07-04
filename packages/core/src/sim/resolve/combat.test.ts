import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../events.js';
import type { Unit } from '../types.js';
import { tickStatuses } from './status.js';
import {
  applyActiveDots,
  dealDamage,
  heal,
  resolveAttack,
  tickCooldowns,
} from './combat.js';

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
    attackDamage: 10,
    attackRangeSquared: 100,
    attackCooldownTicks: 5,
    attackCooldownRemaining: 0,
    pos: { x: 0, y: 0 },
    skills: [],
    slow: null,
    shield: null,
    activeDots: [],
    ...overrides,
  };
}

describe('dealDamage', () => {
  it('reduces raw damage by armor before applying to hp', () => {
    const target = makeUnit({ armor: 3, hp: 100 });
    const log: MatchEvent[] = [];

    dealDamage(target, 10, 2, log, 7);

    expect(target.hp).toBe(93);
    expect(log).toEqual([
      { kind: 'damage', tick: 7, sourceId: 2, targetId: 1, amount: 7, absorbed: 0, hpAfter: 93 },
    ]);
  });

  it('floors armor reduction at 0 instead of healing', () => {
    const target = makeUnit({ armor: 50, hp: 100 });
    const log: MatchEvent[] = [];

    dealDamage(target, 10, 2, log, 1);

    expect(target.hp).toBe(100);
    expect(log).toEqual([
      { kind: 'damage', tick: 1, sourceId: 2, targetId: 1, amount: 0, absorbed: 0, hpAfter: 100 },
    ]);
  });

  it('shield absorbs damage before hp on a partial hit', () => {
    const target = makeUnit({ hp: 100, shield: { magnitude: 5, remainingTicks: 10 } });
    const log: MatchEvent[] = [];

    dealDamage(target, 8, 2, log, 1);

    expect(target.hp).toBe(97);
    expect(target.shield).toEqual({ magnitude: 0, remainingTicks: 10 });
    expect(log).toEqual([
      { kind: 'damage', tick: 1, sourceId: 2, targetId: 1, amount: 8, absorbed: 5, hpAfter: 97 },
    ]);
  });

  it('shield fully absorbs damage smaller than its pool', () => {
    const target = makeUnit({ hp: 100, shield: { magnitude: 20, remainingTicks: 10 } });
    const log: MatchEvent[] = [];

    dealDamage(target, 8, 2, log, 1);

    expect(target.hp).toBe(100);
    expect(target.shield).toEqual({ magnitude: 12, remainingTicks: 10 });
    expect(log).toEqual([
      { kind: 'damage', tick: 1, sourceId: 2, targetId: 1, amount: 8, absorbed: 8, hpAfter: 100 },
    ]);
  });

  it('emits death exactly once when a hit is lethal and clamps hp at 0', () => {
    const target = makeUnit({ hp: 5 });
    const log: MatchEvent[] = [];

    dealDamage(target, 10, 2, log, 3);

    expect(target.hp).toBe(0);
    expect(log).toEqual([
      { kind: 'damage', tick: 3, sourceId: 2, targetId: 1, amount: 10, absorbed: 0, hpAfter: 0 },
      { kind: 'death', tick: 3, unitId: 1 },
    ]);
  });

  it('does not re-emit death on a second hit against an already-dead unit', () => {
    const target = makeUnit({ hp: 5 });
    const log: MatchEvent[] = [];

    dealDamage(target, 10, 2, log, 3);
    dealDamage(target, 10, 2, log, 4);

    expect(target.hp).toBe(0);
    expect(log).toEqual([
      { kind: 'damage', tick: 3, sourceId: 2, targetId: 1, amount: 10, absorbed: 0, hpAfter: 0 },
      { kind: 'death', tick: 3, unitId: 1 },
      { kind: 'damage', tick: 4, sourceId: 2, targetId: 1, amount: 10, absorbed: 0, hpAfter: 0 },
    ]);
  });
});

describe('heal', () => {
  it('restores hp by the given amount', () => {
    const target = makeUnit({ hp: 50, maxHp: 100 });
    const log: MatchEvent[] = [];

    heal(target, 20, 2, log, 4);

    expect(target.hp).toBe(70);
    expect(log).toEqual([
      { kind: 'heal', tick: 4, sourceId: 2, targetId: 1, amount: 20, hpAfter: 70 },
    ]);
  });

  it('caps overheal at maxHp and reports the capped amount', () => {
    const target = makeUnit({ hp: 90, maxHp: 100 });
    const log: MatchEvent[] = [];

    heal(target, 30, 2, log, 4);

    expect(target.hp).toBe(100);
    expect(log).toEqual([
      { kind: 'heal', tick: 4, sourceId: 2, targetId: 1, amount: 10, hpAfter: 100 },
    ]);
  });
});

describe('applyActiveDots', () => {
  it('deals damagePerTick through armor for each active dot', () => {
    const unit = makeUnit({
      armor: 2,
      hp: 100,
      activeDots: [
        { damagePerTick: 5, remainingTicks: 3 },
        { damagePerTick: 7, remainingTicks: 2 },
      ],
    });
    const log: MatchEvent[] = [];

    applyActiveDots(unit, log, 10);

    expect(unit.hp).toBe(92);
    expect(log).toEqual([
      { kind: 'damage', tick: 10, sourceId: null, targetId: 1, amount: 3, absorbed: 0, hpAfter: 97 },
      { kind: 'damage', tick: 10, sourceId: null, targetId: 1, amount: 5, absorbed: 0, hpAfter: 92 },
    ]);
  });

  it('does not touch remainingTicks or remove expired dots', () => {
    const unit = makeUnit({
      activeDots: [{ damagePerTick: 5, remainingTicks: 1 }],
    });
    const log: MatchEvent[] = [];

    applyActiveDots(unit, log, 10);

    expect(unit.activeDots).toEqual([{ damagePerTick: 5, remainingTicks: 1 }]);
  });

  it('deals damagePerTick * K total over K ticks and is gone after tick K', () => {
    const unit = makeUnit({ hp: 100 });
    const log: MatchEvent[] = [];
    const K = 3;
    const damagePerTick = 5;
    unit.activeDots.push({ damagePerTick, remainingTicks: K });

    for (let t = 1; t <= K; t += 1) {
      applyActiveDots(unit, log, t);
      tickStatuses(unit, log, t);
    }

    expect(unit.hp).toBe(100 - damagePerTick * K);
    expect(unit.activeDots).toEqual([]);
  });
});

describe('resolveAttack', () => {
  it('fires when off-cooldown and in range: emits attack then damage, sets cooldown, returns true', () => {
    const attacker = makeUnit({
      id: 1,
      pos: { x: 0, y: 0 },
      attackDamage: 10,
      attackRangeSquared: 100,
      attackCooldownTicks: 5,
      attackCooldownRemaining: 0,
    });
    const target = makeUnit({ id: 2, pos: { x: 5, y: 0 }, hp: 50 });
    const log: MatchEvent[] = [];

    const result = resolveAttack(attacker, target, log, 2);

    expect(result).toBe(true);
    expect(attacker.attackCooldownRemaining).toBe(5);
    expect(log).toEqual([
      { kind: 'attack', tick: 2, unitId: 1, targetId: 2 },
      { kind: 'damage', tick: 2, sourceId: 1, targetId: 2, amount: 10, absorbed: 0, hpAfter: 40 },
    ]);
  });

  it('is a no-op when still on cooldown', () => {
    const attacker = makeUnit({
      id: 1,
      pos: { x: 0, y: 0 },
      attackRangeSquared: 100,
      attackCooldownRemaining: 3,
    });
    const target = makeUnit({ id: 2, pos: { x: 5, y: 0 }, hp: 50 });
    const log: MatchEvent[] = [];

    const result = resolveAttack(attacker, target, log, 2);

    expect(result).toBe(false);
    expect(log).toEqual([]);
    expect(target.hp).toBe(50);
  });

  it('is a no-op when the target is out of range', () => {
    const attacker = makeUnit({
      id: 1,
      pos: { x: 0, y: 0 },
      attackRangeSquared: 4,
      attackCooldownRemaining: 0,
    });
    const target = makeUnit({ id: 2, pos: { x: 100, y: 0 }, hp: 50 });
    const log: MatchEvent[] = [];

    const result = resolveAttack(attacker, target, log, 2);

    expect(result).toBe(false);
    expect(log).toEqual([]);
    expect(target.hp).toBe(50);
  });
});

describe('tickCooldowns', () => {
  it('decrements attack cooldown and each skill cooldown by 1, floored at 0', () => {
    const unit = makeUnit({
      attackCooldownRemaining: 2,
      skills: [
        { skillId: 'a', cooldownRemaining: 1 },
        { skillId: 'b', cooldownRemaining: 0 },
      ],
    });

    tickCooldowns(unit);

    expect(unit.attackCooldownRemaining).toBe(1);
    expect(unit.skills).toEqual([
      { skillId: 'a', cooldownRemaining: 0 },
      { skillId: 'b', cooldownRemaining: 0 },
    ]);

    tickCooldowns(unit);

    expect(unit.attackCooldownRemaining).toBe(0);
    expect(unit.skills).toEqual([
      { skillId: 'a', cooldownRemaining: 0 },
      { skillId: 'b', cooldownRemaining: 0 },
    ]);
  });
});
