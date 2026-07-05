import { describe, expect, it } from 'vitest';
import type { MatchEvent } from './events.js';
import type { Rng } from './prng.js';
import type { Unit, WorldState } from './types.js';
import type { Action, Behavior, UnitView, WorldView } from './behavior.js';
import { createContentRegistry } from '../content/registry.js';
import type { ContentRegistry } from '../content/registry.js';
import { checkWinner, stepTick } from './loop.js';

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 1,
    team: 'A',
    roleId: 'test-role',
    behaviorId: 'idle-behavior',
    maxHp: 100,
    hp: 100,
    armor: 0,
    moveSpeed: 10,
    attackDamage: 10,
    attackRangeSquared: 10000,
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

function noopRng(): Rng {
  return {
    next: () => {
      throw new Error('rng.next should not be called by these fixtures');
    },
    float: () => {
      throw new Error('rng.float should not be called by these fixtures');
    },
  };
}

function makeWorld(units: Unit[], overrides: Partial<WorldState> = {}): WorldState {
  return {
    version: 1,
    seed: 1,
    tick: 0,
    units,
    eventLog: [],
    rng: noopRng(),
    ...overrides,
  };
}

// A registry whose behavior lookup is driven by a per-test map from
// behaviorId to a scripted decide function, so tests can control exactly
// what action each unit takes without depending on real content behaviors.
function makeRegistry(
  decisions: Record<string, (self: UnitView, world: WorldView, rng: Rng) => Action>,
  skillsToLoad: Array<Parameters<ContentRegistry['loadSkill']>[0]> = [],
): ContentRegistry {
  const registry = createContentRegistry();
  for (const [id, decide] of Object.entries(decisions)) {
    const behavior: Behavior = { id, decide };
    registry.registerBehavior(behavior);
  }
  for (const skill of skillsToLoad) {
    registry.loadSkill(skill);
  }
  return registry;
}

const idle: Action = { kind: 'idle' };

describe('checkWinner', () => {
  it('returns null when both teams have a living unit', () => {
    const units = [makeUnit({ id: 1, team: 'A', hp: 10 }), makeUnit({ id: 2, team: 'B', hp: 10 })];
    expect(checkWinner(units)).toBeNull();
  });

  it('returns A when only team A has a living unit', () => {
    const units = [makeUnit({ id: 1, team: 'A', hp: 10 }), makeUnit({ id: 2, team: 'B', hp: 0 })];
    expect(checkWinner(units)).toBe('A');
  });

  it('returns B when only team B has a living unit', () => {
    const units = [makeUnit({ id: 1, team: 'A', hp: 0 }), makeUnit({ id: 2, team: 'B', hp: 10 })];
    expect(checkWinner(units)).toBe('B');
  });

  it('returns draw when no unit is alive on either team', () => {
    const units = [makeUnit({ id: 1, team: 'A', hp: 0 }), makeUnit({ id: 2, team: 'B', hp: 0 })];
    expect(checkWinner(units)).toBe('draw');
  });
});

describe('stepTick', () => {
  it('increments world.tick by exactly 1', () => {
    const world = makeWorld([makeUnit({ id: 1, behaviorId: 'idle' })], { tick: 5 });
    const registry = makeRegistry({ idle: () => idle });

    stepTick(world, registry);

    expect(world.tick).toBe(6);
  });

  it('never calls decide for a dead unit', () => {
    const dead = makeUnit({ id: 1, hp: 0, behaviorId: 'throws' });
    const alive = makeUnit({ id: 2, behaviorId: 'idle', team: 'B' });
    const world = makeWorld([dead, alive]);
    const registry = makeRegistry({
      throws: () => {
        throw new Error('decide should never be called for a dead unit');
      },
      idle: () => idle,
    });

    expect(() => stepTick(world, registry)).not.toThrow();
  });

  it('idle action does not move, attack, or emit any resolver event', () => {
    const unit = makeUnit({ id: 1, behaviorId: 'idle', pos: { x: 5, y: 5 } });
    const world = makeWorld([unit]);
    const registry = makeRegistry({ idle: () => idle });

    stepTick(world, registry);

    expect(unit.pos).toEqual({ x: 5, y: 5 });
    expect(world.eventLog.filter((e) => e.kind !== 'tick')).toEqual([]);
  });

  it('move action steps the unit toward the given position and emits a move event', () => {
    const unit = makeUnit({ id: 1, behaviorId: 'mover', pos: { x: 0, y: 0 }, moveSpeed: 3 });
    const world = makeWorld([unit]);
    const registry = makeRegistry({
      mover: () => ({ kind: 'move', to: { x: 10, y: 0 } }),
    });

    stepTick(world, registry);

    expect(unit.pos).toEqual({ x: 3, y: 0 });
    expect(world.eventLog).toContainEqual({
      kind: 'move',
      tick: 1,
      unitId: 1,
      from: { x: 0, y: 0 },
      to: { x: 3, y: 0 },
    });
  });

  it('move-toward action resolves the target id and steps toward its position', () => {
    const mover = makeUnit({ id: 1, behaviorId: 'mover', pos: { x: 0, y: 0 }, moveSpeed: 3 });
    const target = makeUnit({ id: 2, team: 'B', behaviorId: 'idle', pos: { x: 10, y: 0 } });
    const world = makeWorld([mover, target]);
    const registry = makeRegistry({
      mover: () => ({ kind: 'move-toward', targetId: 2 }),
      idle: () => idle,
    });

    stepTick(world, registry);

    expect(mover.pos).toEqual({ x: 3, y: 0 });
  });

  it('move-toward action is a silent no-op when the target id does not resolve', () => {
    const mover = makeUnit({ id: 1, behaviorId: 'mover', pos: { x: 0, y: 0 }, moveSpeed: 3 });
    const world = makeWorld([mover]);
    const registry = makeRegistry({
      mover: () => ({ kind: 'move-toward', targetId: 999 }),
    });

    expect(() => stepTick(world, registry)).not.toThrow();
    expect(mover.pos).toEqual({ x: 0, y: 0 });
  });

  it('attack action resolves the target id and applies resolveAttack (attack + damage events, cooldown set)', () => {
    const attacker = makeUnit({
      id: 1,
      behaviorId: 'attacker',
      pos: { x: 0, y: 0 },
      attackDamage: 10,
      attackRangeSquared: 100,
      attackCooldownTicks: 5,
    });
    const target = makeUnit({ id: 2, team: 'B', behaviorId: 'idle', pos: { x: 5, y: 0 }, hp: 50 });
    const world = makeWorld([attacker, target]);
    const registry = makeRegistry({
      attacker: () => ({ kind: 'attack', targetId: 2 }),
      idle: () => idle,
    });

    stepTick(world, registry);

    // Set to 5 by resolveAttack in the action phase, then decremented once by
    // tickCooldowns in the same tick's housekeeping phase.
    expect(attacker.attackCooldownRemaining).toBe(4);
    expect(target.hp).toBe(40);
    expect(world.eventLog).toContainEqual({ kind: 'attack', tick: 1, unitId: 1, targetId: 2 });
  });

  it('attack action is a silent no-op when the target id does not resolve', () => {
    const attacker = makeUnit({ id: 1, behaviorId: 'attacker', pos: { x: 0, y: 0 } });
    const world = makeWorld([attacker]);
    const registry = makeRegistry({
      attacker: () => ({ kind: 'attack', targetId: 999 }),
    });

    expect(() => stepTick(world, registry)).not.toThrow();
    expect(world.eventLog.filter((e) => e.kind !== 'tick')).toEqual([]);
  });

  describe('cast action', () => {
    const skillFixture = {
      id: 'fireball',
      name: 'Fireball',
      cooldownTicks: 10,
      rangeSquared: 100,
      target: 'enemy' as const,
      effect: { kind: 'direct-damage' as const, amount: 15 },
    };

    it('resolves the effect and sets the skill cooldown when off-cooldown and in range', () => {
      const caster = makeUnit({
        id: 1,
        behaviorId: 'caster',
        pos: { x: 0, y: 0 },
        skills: [{ skillId: 'fireball', cooldownRemaining: 0 }],
      });
      const target = makeUnit({ id: 2, team: 'B', behaviorId: 'idle', pos: { x: 5, y: 0 }, hp: 50 });
      const world = makeWorld([caster, target]);
      const registry = makeRegistry(
        {
          caster: () => ({ kind: 'cast', skillId: 'fireball', targetId: 2 }),
          idle: () => idle,
        },
        [skillFixture],
      );

      stepTick(world, registry);

      // Set to 10 by the loop's cast gating in the action phase, then
      // decremented once by tickCooldowns in the same tick's housekeeping.
      expect(target.hp).toBe(35);
      expect(caster.skills[0]?.cooldownRemaining).toBe(9);
      expect(world.eventLog).toContainEqual({
        kind: 'cast',
        tick: 1,
        unitId: 1,
        skillId: 'fireball',
        targetId: 2,
      });
    });

    it('is a no-op when the skill is still on cooldown', () => {
      const caster = makeUnit({
        id: 1,
        behaviorId: 'caster',
        pos: { x: 0, y: 0 },
        skills: [{ skillId: 'fireball', cooldownRemaining: 3 }],
      });
      const target = makeUnit({ id: 2, team: 'B', behaviorId: 'idle', pos: { x: 5, y: 0 }, hp: 50 });
      const world = makeWorld([caster, target]);
      const registry = makeRegistry(
        {
          caster: () => ({ kind: 'cast', skillId: 'fireball', targetId: 2 }),
          idle: () => idle,
        },
        [skillFixture],
      );

      stepTick(world, registry);

      expect(target.hp).toBe(50);
      expect(caster.skills[0]?.cooldownRemaining).toBe(2);
      expect(world.eventLog.filter((e) => e.kind === 'cast')).toEqual([]);
    });

    it('is a no-op when the unit has no matching SkillState', () => {
      const caster = makeUnit({ id: 1, behaviorId: 'caster', pos: { x: 0, y: 0 }, skills: [] });
      const target = makeUnit({ id: 2, team: 'B', behaviorId: 'idle', pos: { x: 5, y: 0 }, hp: 50 });
      const world = makeWorld([caster, target]);
      const registry = makeRegistry(
        {
          caster: () => ({ kind: 'cast', skillId: 'fireball', targetId: 2 }),
          idle: () => idle,
        },
        [skillFixture],
      );

      expect(() => stepTick(world, registry)).not.toThrow();
      expect(target.hp).toBe(50);
    });

    it('is a no-op when the target is out of the skill range', () => {
      const caster = makeUnit({
        id: 1,
        behaviorId: 'caster',
        pos: { x: 0, y: 0 },
        skills: [{ skillId: 'fireball', cooldownRemaining: 0 }],
      });
      const target = makeUnit({
        id: 2,
        team: 'B',
        behaviorId: 'idle',
        pos: { x: 100, y: 0 },
        hp: 50,
      });
      const world = makeWorld([caster, target]);
      const registry = makeRegistry(
        {
          caster: () => ({ kind: 'cast', skillId: 'fireball', targetId: 2 }),
          idle: () => idle,
        },
        [skillFixture],
      );

      stepTick(world, registry);

      expect(target.hp).toBe(50);
      expect(caster.skills[0]?.cooldownRemaining).toBe(0);
      expect(world.eventLog.filter((e) => e.kind === 'cast')).toEqual([]);
    });

    it('is a silent no-op when the target id does not resolve', () => {
      const caster = makeUnit({
        id: 1,
        behaviorId: 'caster',
        pos: { x: 0, y: 0 },
        skills: [{ skillId: 'fireball', cooldownRemaining: 0 }],
      });
      const world = makeWorld([caster]);
      const registry = makeRegistry(
        { caster: () => ({ kind: 'cast', skillId: 'fireball', targetId: 999 }) },
        [skillFixture],
      );

      expect(() => stepTick(world, registry)).not.toThrow();
      expect(caster.skills[0]?.cooldownRemaining).toBe(0);
    });
  });

  it('builds a WorldView whose enemiesOf excludes a unit killed earlier in the same action phase', () => {
    // Ascending order: unit 1 (A) kills unit 2 (B) outright; unit 3 (B) then
    // decides and must see a WorldView with unit 2 already excluded.
    const killer = makeUnit({
      id: 1,
      team: 'A',
      behaviorId: 'killer',
      pos: { x: 0, y: 0 },
      attackDamage: 999,
      attackRangeSquared: 10000,
    });
    const victim = makeUnit({ id: 2, team: 'B', behaviorId: 'idle', pos: { x: 1, y: 0 }, hp: 10 });
    const witness = makeUnit({ id: 3, team: 'A', behaviorId: 'witness', pos: { x: 0, y: 0 } });
    const world = makeWorld([killer, victim, witness]);

    let observedEnemyIds: number[] | null = null;
    const registry = makeRegistry({
      killer: () => ({ kind: 'attack', targetId: 2 }),
      idle: () => idle,
      witness: (self, worldView) => {
        observedEnemyIds = worldView.enemiesOf(self).map((u) => u.id);
        return idle;
      },
    });

    stepTick(world, registry);

    expect(victim.hp).toBe(0);
    expect(observedEnemyIds).toEqual([]);
  });

  it('housekeeping applies dots (which may kill), then statuses, then cooldowns, for units alive at phase start', () => {
    const unit = makeUnit({
      id: 1,
      behaviorId: 'idle',
      hp: 5,
      attackCooldownRemaining: 2,
      activeDots: [{ damagePerTick: 5, remainingTicks: 1 }],
      slow: { magnitude: 50, remainingTicks: 1 },
    });
    const world = makeWorld([unit]);
    const registry = makeRegistry({ idle: () => idle });

    stepTick(world, registry);

    expect(unit.hp).toBe(0);
    expect(unit.activeDots).toEqual([]);
    expect(unit.slow).toBeNull();
    expect(unit.attackCooldownRemaining).toBe(1);
    expect(world.eventLog).toContainEqual({ kind: 'death', tick: 1, unitId: 1 });
  });

  it('skips housekeeping for a unit that died in the action phase this tick', () => {
    const killer = makeUnit({
      id: 1,
      team: 'A',
      behaviorId: 'killer',
      pos: { x: 0, y: 0 },
      attackDamage: 999,
      attackRangeSquared: 10000,
    });
    const victim = makeUnit({
      id: 2,
      team: 'B',
      behaviorId: 'idle',
      pos: { x: 1, y: 0 },
      hp: 10,
      attackCooldownRemaining: 3,
    });
    const world = makeWorld([killer, victim]);
    const registry = makeRegistry({
      killer: () => ({ kind: 'attack', targetId: 2 }),
      idle: () => idle,
    });

    stepTick(world, registry);

    // tickCooldowns is skipped for the freshly-dead victim: cooldown value is
    // untouched, not decremented.
    expect(victim.attackCooldownRemaining).toBe(3);
  });

  it('emits exactly one tick event per call, after all other events, with the incremented tick', () => {
    const attacker = makeUnit({
      id: 1,
      behaviorId: 'attacker',
      pos: { x: 0, y: 0 },
      attackRangeSquared: 100,
    });
    const target = makeUnit({ id: 2, team: 'B', behaviorId: 'idle', pos: { x: 5, y: 0 }, hp: 50 });
    const world = makeWorld([attacker, target], { tick: 9 });
    const registry = makeRegistry({
      attacker: () => ({ kind: 'attack', targetId: 2 }),
      idle: () => idle,
    });

    stepTick(world, registry);

    const tickEvents = world.eventLog.filter((e): e is Extract<MatchEvent, { kind: 'tick' }> =>
      e.kind === 'tick',
    );
    expect(tickEvents).toEqual([{ kind: 'tick', tick: 10 }]);
    expect(world.eventLog.at(-1)).toEqual({ kind: 'tick', tick: 10 });
  });

  it('returns the winner from checkWinner after applying the tick', () => {
    const killer = makeUnit({
      id: 1,
      team: 'A',
      behaviorId: 'killer',
      pos: { x: 0, y: 0 },
      attackDamage: 999,
      attackRangeSquared: 10000,
    });
    const victim = makeUnit({ id: 2, team: 'B', behaviorId: 'idle', pos: { x: 1, y: 0 }, hp: 10 });
    const world = makeWorld([killer, victim]);
    const registry = makeRegistry({
      killer: () => ({ kind: 'attack', targetId: 2 }),
      idle: () => idle,
    });

    const winner = stepTick(world, registry);

    expect(winner).toBe('A');
  });

  it('returns null when both teams still have a living unit', () => {
    const world = makeWorld([
      makeUnit({ id: 1, team: 'A', behaviorId: 'idle' }),
      makeUnit({ id: 2, team: 'B', behaviorId: 'idle' }),
    ]);
    const registry = makeRegistry({ idle: () => idle });

    expect(stepTick(world, registry)).toBeNull();
  });
});
