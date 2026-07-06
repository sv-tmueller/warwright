import { describe, expect, it } from 'vitest';
import type { Behavior, UnitView, WorldView } from '../sim/behavior.js';
import { createContentRegistry } from './registry.js';

const fixtureBehavior: Behavior = {
  id: 'fixture',
  decide: () => ({ kind: 'idle' }),
};

const validRole = {
  id: 'warrior',
  name: 'Warrior',
  maxHp: 100,
  armor: 5,
  moveSpeed: 3,
  attack: { damage: 10, rangeSquared: 400, cooldownTicks: 20 },
};

const invalidRole = { ...validRole, maxHp: -1 };

const validSkill = {
  id: 'fireball',
  name: 'Fireball',
  cooldownTicks: 40,
  rangeSquared: 900,
  target: 'enemy',
  effect: { kind: 'direct-damage', amount: 20 },
};

const invalidSkill = {
  ...validSkill,
  effect: { kind: 'direct-damage' },
};

function makeUnitView(id: number): UnitView {
  return {
    id,
    team: 'A',
    roleId: 'warrior',
    hp: 100,
    maxHp: 100,
    pos: { x: 0, y: 0 },
    skills: [],
    attackRangeSquared: 400,
  };
}

describe('createContentRegistry', () => {
  it('throws on getBehavior with an unknown id', () => {
    const registry = createContentRegistry();
    expect(() => registry.getBehavior('nope')).toThrow();
  });

  it('returns the same behavior module after registerBehavior', () => {
    const registry = createContentRegistry();
    registry.registerBehavior(fixtureBehavior);
    expect(registry.getBehavior('fixture')).toBe(fixtureBehavior);
  });

  it('throws when loading an invalid role or skill', () => {
    const registry = createContentRegistry();
    expect(() => registry.loadRole(invalidRole)).toThrow();
    expect(() => registry.loadSkill(invalidSkill)).toThrow();
  });

  it('loadRole then getRole returns the parsed Role; getRole/getSkill throw on unknown id', () => {
    const registry = createContentRegistry();
    const parsed = registry.loadRole(validRole);
    expect(registry.getRole('warrior')).toEqual(parsed);
    expect(() => registry.getRole('nope')).toThrow();
    expect(() => registry.getSkill('nope')).toThrow();
  });

  it('throws on duplicate ids for registerBehavior, loadRole, and loadSkill', () => {
    const registry = createContentRegistry();
    registry.registerBehavior(fixtureBehavior);
    expect(() => registry.registerBehavior(fixtureBehavior)).toThrow();

    registry.loadRole(validRole);
    expect(() => registry.loadRole(validRole)).toThrow();

    registry.loadSkill(validSkill);
    expect(() => registry.loadSkill(validSkill)).toThrow();
  });

  it('throws on registerBehavior with an empty id', () => {
    const registry = createContentRegistry();
    expect(() => registry.registerBehavior({ id: '', decide: () => ({ kind: 'idle' }) })).toThrow();
  });

  it('exercises WorldView.enemiesOf, ascending-id order, and the Action shape', () => {
    const registry = createContentRegistry();
    const self = makeUnitView(1);
    const lowestEnemy = makeUnitView(3);
    const otherEnemy = makeUnitView(5);

    const attackLowestId: Behavior = {
      id: 'attack-lowest-id',
      decide: (unit, world) => {
        const enemies = world.enemiesOf(unit);
        const target = enemies[0];
        return target ? { kind: 'attack', targetId: target.id } : { kind: 'idle' };
      },
    };
    registry.registerBehavior(attackLowestId);

    const worldWithEnemies: WorldView = {
      alliesOf: () => [],
      enemiesOf: () => [lowestEnemy, otherEnemy],
    };
    expect(
      registry
        .getBehavior('attack-lowest-id')
        .decide(self, worldWithEnemies, { next: () => 0, float: () => 0 }),
    ).toEqual({
      kind: 'attack',
      targetId: 3,
    });

    const worldWithoutEnemies: WorldView = {
      alliesOf: () => [],
      enemiesOf: () => [],
    };
    expect(
      registry
        .getBehavior('attack-lowest-id')
        .decide(self, worldWithoutEnemies, { next: () => 0, float: () => 0 }),
    ).toEqual({ kind: 'idle' });
  });
});
