import { describe, expect, it } from 'vitest';
import type { Rng } from '../../sim/prng.js';
import type { UnitView, WorldView } from '../../sim/behavior.js';
import { aggroLowestHp } from './aggro-lowest-hp.js';

function unit(id: number, hp: number, pos: { x: number; y: number } = { x: 0, y: 0 }): UnitView {
  return {
    id,
    team: 'A',
    roleId: 'warrior',
    hp,
    maxHp: 100,
    pos,
    skills: [],
    attackRangeSquared: 400,
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
    throw new Error('alliesOf should never be read by aggro-lowest-hp');
  };
}

const self = unit(1, 100);

describe('aggroLowestHp', () => {
  it('has the expected id', () => {
    expect(aggroLowestHp.id).toBe('aggro-lowest-hp');
  });

  it('attacks the enemy with the lowest hp among distinct values', () => {
    const enemies = [unit(2, 50), unit(3, 10), unit(4, 30)];
    const world: WorldView = { alliesOf: throwingAllies(), enemiesOf: () => enemies };
    expect(aggroLowestHp.decide(self, world, throwingRng())).toEqual({
      kind: 'attack',
      targetId: 3,
    });
  });

  it('breaks a tie at minimum hp using rng, picking each tied enemy in turn', () => {
    const enemies = [unit(2, 10), unit(3, 10), unit(4, 50)];
    const world: WorldView = { alliesOf: throwingAllies(), enemiesOf: () => enemies };
    expect(aggroLowestHp.decide(self, world, stubRng([0]))).toEqual({
      kind: 'attack',
      targetId: 2,
    });
    expect(aggroLowestHp.decide(self, world, stubRng([1]))).toEqual({
      kind: 'attack',
      targetId: 3,
    });
  });

  it('idles when there are no enemies', () => {
    const world: WorldView = { alliesOf: throwingAllies(), enemiesOf: () => [] };
    expect(aggroLowestHp.decide(self, world, throwingRng())).toEqual({ kind: 'idle' });
  });

  it('moves toward the selected target when it is out of attack range', () => {
    const enemies = [unit(2, 10, { x: 100, y: 0 })];
    const world: WorldView = { alliesOf: throwingAllies(), enemiesOf: () => enemies };
    expect(aggroLowestHp.decide(self, world, throwingRng())).toEqual({
      kind: 'move-toward',
      targetId: 2,
    });
  });

  it('attacks the selected target when it is in attack range', () => {
    const enemies = [unit(2, 10, { x: 0, y: 0 })];
    const world: WorldView = { alliesOf: throwingAllies(), enemiesOf: () => enemies };
    expect(aggroLowestHp.decide(self, world, throwingRng())).toEqual({
      kind: 'attack',
      targetId: 2,
    });
  });

  it('is deterministic: identical inputs yield identical actions', () => {
    const enemies = [unit(2, 50), unit(3, 10), unit(4, 30)];
    const world: WorldView = { alliesOf: throwingAllies(), enemiesOf: () => enemies };
    const first = aggroLowestHp.decide(self, world, throwingRng());
    const second = aggroLowestHp.decide(self, world, throwingRng());
    expect(first).toEqual(second);
  });
});
