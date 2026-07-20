import { describe, expect, it } from 'vitest';
import type { Rng } from '../../sim/prng.js';
import type { UnitView, WorldView } from '../../sim/behavior.js';
import { focusCasters } from './focus-casters.js';

function unit(id: number, x: number, skillIds: readonly string[]): UnitView {
  return {
    id,
    team: 'B',
    roleId: 'mage',
    hp: 100,
    maxHp: 100,
    pos: { x, y: 0 },
    skills: skillIds.map((skillId) => ({ skillId, cooldownRemaining: 0 })),
    attackRangeSquared: 10000,
  };
}

function throwingRng(): Rng {
  return {
    next: () => {
      throw new Error('rng.next should not be called');
    },
    float: () => {
      throw new Error('float unused');
    },
  };
}

function stubRng(values: readonly number[]): Rng {
  let i = 0;
  return {
    next: () => {
      const value = values[i];
      i += 1;
      if (value === undefined) throw new Error('stubRng ran out of values');
      return value;
    },
    float: () => {
      throw new Error('float unused');
    },
  };
}

function throwingAllies(): WorldView['alliesOf'] {
  return () => {
    throw new Error('alliesOf should never be read by focus-casters');
  };
}

function throwingObservation(): WorldView['observationOf'] {
  return () => {
    throw new Error('observationOf should never be read by focus-casters');
  };
}

function worldWithEnemies(enemies: readonly UnitView[]): WorldView {
  return {
    alliesOf: throwingAllies(),
    enemiesOf: () => enemies,
    observationOf: throwingObservation(),
  };
}

const self = unit(1, 0, []);

describe('focusCasters', () => {
  it('has the expected id', () => {
    expect(focusCasters.id).toBe('focus-casters');
  });

  it('prefers a farther caster over a nearer non-caster', () => {
    const casterA = unit(2, 100, ['fireball']); // farther, has skills
    const nonCasterB = unit(3, 10, []); // nearer, no skills
    const world: WorldView = worldWithEnemies([casterA, nonCasterB]);
    expect(focusCasters.decide(self, world, throwingRng())).toEqual({
      kind: 'attack',
      targetId: 2,
    });
  });

  it('falls back to the nearest enemy overall when no enemy has skills', () => {
    const far = unit(2, 100, []);
    const near = unit(3, 10, []);
    const world: WorldView = worldWithEnemies([far, near]);
    expect(focusCasters.decide(self, world, throwingRng())).toEqual({
      kind: 'attack',
      targetId: 3,
    });
  });

  it('breaks a tie between equidistant casters using rng, picking each in turn', () => {
    const casterA = unit(2, 10, ['fireball']);
    const casterB = unit(3, -10, ['heal']);
    const world: WorldView = worldWithEnemies([casterA, casterB]);
    expect(focusCasters.decide(self, world, stubRng([0]))).toEqual({
      kind: 'attack',
      targetId: 2,
    });
    expect(focusCasters.decide(self, world, stubRng([1]))).toEqual({
      kind: 'attack',
      targetId: 3,
    });
  });

  it('idles when there are no enemies', () => {
    const world: WorldView = worldWithEnemies([]);
    expect(focusCasters.decide(self, world, throwingRng())).toEqual({ kind: 'idle' });
  });

  it('moves toward the selected target when it is out of attack range', () => {
    const farCaster = unit(2, 200, ['fireball']);
    const world: WorldView = worldWithEnemies([farCaster]);
    expect(focusCasters.decide(self, world, throwingRng())).toEqual({
      kind: 'move-toward',
      targetId: 2,
    });
  });

  it('attacks the selected target when it is in attack range', () => {
    const near = unit(2, 10, []);
    const world: WorldView = worldWithEnemies([near]);
    expect(focusCasters.decide(self, world, throwingRng())).toEqual({
      kind: 'attack',
      targetId: 2,
    });
  });

  it('is deterministic: identical inputs yield identical actions', () => {
    const casterA = unit(2, 100, ['fireball']);
    const nonCasterB = unit(3, 10, []);
    const world: WorldView = worldWithEnemies([casterA, nonCasterB]);
    const first = focusCasters.decide(self, world, throwingRng());
    const second = focusCasters.decide(self, world, throwingRng());
    expect(first).toEqual(second);
  });
});
