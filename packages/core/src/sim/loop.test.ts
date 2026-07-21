import { describe, expect, it } from 'vitest';
import type { MatchEvent } from './events.js';
import type { Rng } from './prng.js';
import type { Unit, WorldState } from './types.js';
import type { Action, Behavior, UnitView, WorldView } from './behavior.js';
import { createContentRegistry } from '../content/registry.js';
import type { ContentRegistry } from '../content/registry.js';
import { EXTERNAL_BEHAVIOR_ID } from './constants.js';
import { checkWinner, stepTick } from './loop.js';
import { encodeObservationFromUnits } from './observation.js';

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
    stun: null,
    empower: null,
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

  it('builds a WorldView whose observationOf includes dead units and matches encodeObservationFromUnits', () => {
    // Unlike enemiesOf/alliesOf (living-only), observationOf must reflect
    // ALL units (including dead ones) so a policy Behavior can reproduce the
    // exact training observation -- see sim/behavior.ts's WorldView doc.
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

    let observedVector: readonly number[] | null = null;
    const registry = makeRegistry({
      killer: () => ({ kind: 'attack', targetId: 2 }),
      idle: () => idle,
      witness: (self, worldView) => {
        observedVector = worldView.observationOf(self);
        return idle;
      },
    });

    stepTick(world, registry);

    expect(victim.hp).toBe(0);
    // The victim died earlier in this same action phase, yet observationOf
    // still includes its (now-dead) block -- observationOf reads
    // `world.units` directly, never the living() filter alliesOf/enemiesOf
    // use.
    expect(observedVector).toEqual(encodeObservationFromUnits(world.units, 3));
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

  describe('stun gating', () => {
    it('suppresses a move action for a stunned unit: pos unchanged, no move event', () => {
      const unit = makeUnit({
        id: 1,
        behaviorId: 'mover',
        pos: { x: 0, y: 0 },
        moveSpeed: 3,
        stun: { magnitude: 0, remainingTicks: 5 },
      });
      const world = makeWorld([unit]);
      const registry = makeRegistry({
        mover: () => ({ kind: 'move', to: { x: 10, y: 0 } }),
      });

      stepTick(world, registry);

      expect(unit.pos).toEqual({ x: 0, y: 0 });
      expect(world.eventLog.filter((e) => e.kind === 'move')).toEqual([]);
    });

    it('suppresses an attack action for a stunned unit: target hp unchanged, no attack/damage events', () => {
      const attacker = makeUnit({
        id: 1,
        behaviorId: 'attacker',
        pos: { x: 0, y: 0 },
        attackRangeSquared: 100,
        stun: { magnitude: 0, remainingTicks: 5 },
      });
      const target = makeUnit({ id: 2, team: 'B', behaviorId: 'idle', pos: { x: 5, y: 0 }, hp: 50 });
      const world = makeWorld([attacker, target]);
      const registry = makeRegistry({
        attacker: () => ({ kind: 'attack', targetId: 2 }),
        idle: () => idle,
      });

      stepTick(world, registry);

      expect(target.hp).toBe(50);
      expect(world.eventLog.filter((e) => e.kind === 'attack' || e.kind === 'damage')).toEqual([]);
    });

    it('still ticks cooldowns and the stun timer for a stunned unit', () => {
      const unit = makeUnit({
        id: 1,
        behaviorId: 'idle',
        attackCooldownRemaining: 3,
        stun: { magnitude: 0, remainingTicks: 2 },
      });
      const world = makeWorld([unit]);
      const registry = makeRegistry({ idle: () => idle });

      stepTick(world, registry);

      expect(unit.attackCooldownRemaining).toBe(2);
      expect(unit.stun).toEqual({ magnitude: 0, remainingTicks: 1 });
    });

    it('still calls decide (RNG draw order unaffected) for a stunned unit even though the action is not applied', () => {
      const unit = makeUnit({
        id: 1,
        behaviorId: 'mover',
        pos: { x: 0, y: 0 },
        stun: { magnitude: 0, remainingTicks: 5 },
      });
      const world = makeWorld([unit]);
      let decideCalled = false;
      const registry = makeRegistry({
        mover: () => {
          decideCalled = true;
          return { kind: 'move', to: { x: 10, y: 0 } };
        },
      });

      stepTick(world, registry);

      expect(decideCalled).toBe(true);
      expect(unit.pos).toEqual({ x: 0, y: 0 });
    });

    it('acts again once the stun expires', () => {
      const unit = makeUnit({
        id: 1,
        behaviorId: 'mover',
        pos: { x: 0, y: 0 },
        moveSpeed: 3,
        stun: { magnitude: 0, remainingTicks: 1 },
      });
      const world = makeWorld([unit]);
      const registry = makeRegistry({
        mover: () => ({ kind: 'move', to: { x: 10, y: 0 } }),
      });

      // Tick 1: stunned this tick (action suppressed), stun expires during
      // this tick's housekeeping.
      stepTick(world, registry);
      expect(unit.pos).toEqual({ x: 0, y: 0 });
      expect(unit.stun).toBeNull();

      // Tick 2: no longer stunned, the move action applies normally.
      stepTick(world, registry);
      expect(unit.pos).toEqual({ x: 3, y: 0 });
    });
  });

  describe('external action injection', () => {
    it('applies the action from externalActions for a unit with the external sentinel behaviorId, never calling any registered behavior', () => {
      const external = makeUnit({
        id: 1,
        behaviorId: EXTERNAL_BEHAVIOR_ID,
        pos: { x: 0, y: 0 },
        moveSpeed: 3,
      });
      const world = makeWorld([external]);
      const registry = makeRegistry({
        [EXTERNAL_BEHAVIOR_ID]: () => {
          throw new Error('the registered behavior for the sentinel id must never be called');
        },
      });
      const externalActions = new Map<number, Action>([[1, { kind: 'move', to: { x: 10, y: 0 } }]]);

      stepTick(world, registry, externalActions);

      expect(external.pos).toEqual({ x: 3, y: 0 });
    });

    it('draws zero rng in the decide slot for an external unit (noopRng throws on any call)', () => {
      const external = makeUnit({ id: 1, behaviorId: EXTERNAL_BEHAVIOR_ID, pos: { x: 0, y: 0 } });
      const world = makeWorld([external]);
      const registry = makeRegistry({});
      const externalActions = new Map<number, Action>([[1, idle]]);

      expect(() => stepTick(world, registry, externalActions)).not.toThrow();
    });

    it('throws a clear error when a living external unit has no entry in externalActions', () => {
      const external = makeUnit({ id: 1, behaviorId: EXTERNAL_BEHAVIOR_ID });
      const world = makeWorld([external]);
      const registry = makeRegistry({});

      expect(() => stepTick(world, registry, new Map())).toThrow(/external/i);
      expect(() => stepTick(world, registry, undefined)).toThrow(/external/i);
    });

    it('does not require an externalActions entry for a dead external unit', () => {
      const deadExternal = makeUnit({ id: 1, behaviorId: EXTERNAL_BEHAVIOR_ID, hp: 0 });
      const alive = makeUnit({ id: 2, team: 'B', behaviorId: 'idle' });
      const world = makeWorld([deadExternal, alive]);
      const registry = makeRegistry({ idle: () => idle });

      expect(() => stepTick(world, registry, new Map())).not.toThrow();
    });

    it('leaves non-external units on the same tick deciding via their registered behavior as usual', () => {
      const external = makeUnit({ id: 1, behaviorId: EXTERNAL_BEHAVIOR_ID, pos: { x: 0, y: 0 } });
      const scripted = makeUnit({
        id: 2,
        team: 'B',
        behaviorId: 'mover',
        pos: { x: 0, y: 0 },
        moveSpeed: 3,
      });
      const world = makeWorld([external, scripted]);
      const registry = makeRegistry({
        mover: () => ({ kind: 'move', to: { x: 10, y: 0 } }),
      });
      const externalActions = new Map<number, Action>([[1, idle]]);

      stepTick(world, registry, externalActions);

      expect(scripted.pos).toEqual({ x: 3, y: 0 });
    });
  });
});
