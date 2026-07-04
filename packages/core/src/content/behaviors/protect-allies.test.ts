import { describe, expect, it } from 'vitest';
import type { Rng } from '../../sim/prng.js';
import type { UnitView, WorldView } from '../../sim/behavior.js';
import { protectAllies } from './protect-allies.js';

function unit(id: number, hp: number, maxHp: number): UnitView {
  return {
    id,
    team: 'A',
    roleId: 'warrior',
    hp,
    maxHp,
    pos: { x: 0, y: 0 },
    skills: [],
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

function throwingEnemies(): WorldView['enemiesOf'] {
  return () => {
    throw new Error('enemiesOf should never be read by protect-allies');
  };
}

const self = unit(1, 100, 100);

describe('protectAllies', () => {
  it('has the expected id', () => {
    expect(protectAllies.id).toBe('protect-allies');
  });

  it('moves toward the ally with the lowest hp/maxHp ratio, not the lowest raw hp', () => {
    // ally A: 40/200 = 20%; ally B: 30/80 = 37.5% -- raw hp would wrongly favor B (30 < 40)
    const allyA = unit(2, 40, 200);
    const allyB = unit(3, 30, 80);
    const world: WorldView = { alliesOf: () => [allyA, allyB], enemiesOf: throwingEnemies() };
    expect(protectAllies.decide(self, world, throwingRng())).toEqual({
      kind: 'move-toward',
      targetId: 2,
    });
  });

  it('breaks a tie at the lowest ratio using rng, picking each tied ally in turn', () => {
    // ally A: 50/100 = 50%; ally B: 25/50 = 50% -- tied ratio
    const allyA = unit(2, 50, 100);
    const allyB = unit(3, 25, 50);
    const world: WorldView = { alliesOf: () => [allyA, allyB], enemiesOf: throwingEnemies() };
    expect(protectAllies.decide(self, world, stubRng([0]))).toEqual({
      kind: 'move-toward',
      targetId: 2,
    });
    expect(protectAllies.decide(self, world, stubRng([1]))).toEqual({
      kind: 'move-toward',
      targetId: 3,
    });
  });

  it('idles when there are no allies', () => {
    const world: WorldView = { alliesOf: () => [], enemiesOf: throwingEnemies() };
    expect(protectAllies.decide(self, world, throwingRng())).toEqual({ kind: 'idle' });
  });

  it('is deterministic: identical inputs yield identical actions', () => {
    const allyA = unit(2, 40, 200);
    const allyB = unit(3, 30, 80);
    const world: WorldView = { alliesOf: () => [allyA, allyB], enemiesOf: throwingEnemies() };
    const first = protectAllies.decide(self, world, throwingRng());
    const second = protectAllies.decide(self, world, throwingRng());
    expect(first).toEqual(second);
  });
});
