import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../events.js';
import type { Unit } from '../types.js';
import { applyActiveDots } from './combat.js';
import { tickStatuses } from './status.js';
import { resolveSkillEffect } from './skills.js';
import type { SkillEffect } from './skills.js';

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
    stun: null,
    empower: null,
    activeDots: [],
    ...overrides,
  };
}

describe('resolveSkillEffect', () => {
  it('emits cast before the direct-damage effect and reduces target hp through armor', () => {
    const caster = makeUnit({ id: 1 });
    const target = makeUnit({ id: 2, armor: 3, hp: 100 });
    const log: MatchEvent[] = [];
    const effect: SkillEffect = { kind: 'direct-damage', amount: 10 };

    resolveSkillEffect(caster, target, 'fireball', effect, log, 5);

    expect(target.hp).toBe(93);
    expect(log).toEqual([
      { kind: 'cast', tick: 5, unitId: 1, skillId: 'fireball', targetId: 2 },
      { kind: 'damage', tick: 5, sourceId: 1, targetId: 2, amount: 7, absorbed: 0, hpAfter: 93 },
    ]);
  });

  it('does NOT boost direct-damage skill amount when the caster is empowered (empower is scoped to basic-attack/move only)', () => {
    const caster = makeUnit({ id: 1, empower: { magnitude: 50, remainingTicks: 40 } });
    const target = makeUnit({ id: 2, armor: 0, hp: 100 });
    const log: MatchEvent[] = [];
    const effect: SkillEffect = { kind: 'direct-damage', amount: 10 };

    resolveSkillEffect(caster, target, 'fireball', effect, log, 5);

    expect(target.hp).toBe(90);
    expect(log).toEqual([
      { kind: 'cast', tick: 5, unitId: 1, skillId: 'fireball', targetId: 2 },
      { kind: 'damage', tick: 5, sourceId: 1, targetId: 2, amount: 10, absorbed: 0, hpAfter: 90 },
    ]);
  });

  it('emits cast before the heal effect and restores target hp', () => {
    const caster = makeUnit({ id: 1 });
    const target = makeUnit({ id: 2, hp: 50, maxHp: 100 });
    const log: MatchEvent[] = [];
    const effect: SkillEffect = { kind: 'heal', amount: 20 };

    resolveSkillEffect(caster, target, 'mend', effect, log, 5);

    expect(target.hp).toBe(70);
    expect(log).toEqual([
      { kind: 'cast', tick: 5, unitId: 1, skillId: 'mend', targetId: 2 },
      { kind: 'heal', tick: 5, sourceId: 1, targetId: 2, amount: 20, hpAfter: 70 },
    ]);
  });

  it('emits cast before apply-status: slow mutates unit.slow and emits status-applied', () => {
    const caster = makeUnit({ id: 1 });
    const target = makeUnit({ id: 2 });
    const log: MatchEvent[] = [];
    const effect: SkillEffect = { kind: 'apply-status', status: 'slow', durationTicks: 40, magnitude: 30 };

    resolveSkillEffect(caster, target, 'frost', effect, log, 5);

    expect(target.slow).toEqual({ magnitude: 30, remainingTicks: 40 });
    expect(log).toEqual([
      { kind: 'cast', tick: 5, unitId: 1, skillId: 'frost', targetId: 2 },
      {
        kind: 'status-applied',
        tick: 5,
        targetId: 2,
        status: 'slow',
        magnitude: 30,
        durationTicks: 40,
      },
    ]);
  });

  it('emits cast before apply-status: shield mutates unit.shield and emits status-applied', () => {
    const caster = makeUnit({ id: 1 });
    const target = makeUnit({ id: 2 });
    const log: MatchEvent[] = [];
    const effect: SkillEffect = { kind: 'apply-status', status: 'shield', durationTicks: 10, magnitude: 50 };

    resolveSkillEffect(caster, target, 'barrier', effect, log, 5);

    expect(target.shield).toEqual({ magnitude: 50, remainingTicks: 10 });
    expect(log).toEqual([
      { kind: 'cast', tick: 5, unitId: 1, skillId: 'barrier', targetId: 2 },
      {
        kind: 'status-applied',
        tick: 5,
        targetId: 2,
        status: 'shield',
        magnitude: 50,
        durationTicks: 10,
      },
    ]);
  });

  it('emits cast before apply-status: dot appends to unit.activeDots and emits status-applied', () => {
    const caster = makeUnit({ id: 1 });
    const target = makeUnit({ id: 2 });
    const log: MatchEvent[] = [];
    const effect: SkillEffect = { kind: 'apply-status', status: 'dot', durationTicks: 3, magnitude: 5 };

    resolveSkillEffect(caster, target, 'poison', effect, log, 5);

    expect(target.activeDots).toEqual([{ damagePerTick: 5, remainingTicks: 3 }]);
    expect(log).toEqual([
      { kind: 'cast', tick: 5, unitId: 1, skillId: 'poison', targetId: 2 },
      {
        kind: 'status-applied',
        tick: 5,
        targetId: 2,
        status: 'dot',
        magnitude: 5,
        durationTicks: 3,
      },
    ]);
  });

  it('end-to-end: a dot cast via resolveSkillEffect deals damagePerTick * K over K ticks', () => {
    const caster = makeUnit({ id: 1 });
    const target = makeUnit({ id: 2, hp: 100 });
    const log: MatchEvent[] = [];
    const K = 3;
    const damagePerTick = 5;
    const effect: SkillEffect = { kind: 'apply-status', status: 'dot', durationTicks: K, magnitude: damagePerTick };

    resolveSkillEffect(caster, target, 'poison', effect, log, 0);

    for (let t = 1; t <= K; t += 1) {
      applyActiveDots(target, log, t);
      tickStatuses(target, log, t);
    }

    expect(target.hp).toBe(100 - damagePerTick * K);
    expect(target.activeDots).toEqual([]);
  });
});
