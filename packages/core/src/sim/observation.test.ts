import { describe, expect, it } from 'vitest';
import { skills as skillCatalog } from '../content/data/skills.js';
import type { Action } from './behavior.js';
import { init } from './init.js';
import {
  OBS_ENCODING_VERSION,
  OBS_SELF_ATTACK_COOLDOWN_INDEX,
  OBS_SELF_FIELD_COUNT,
  OBS_SELF_HP_INDEX,
  OBS_SELF_MAX_HP_INDEX,
  OBS_SELF_POS_X_INDEX,
  OBS_SELF_POS_Y_INDEX,
  OBS_SELF_SKILL_COOLDOWN_START_INDEX,
  OBS_UNIT_FIELD_COUNT,
  decodeAction,
  encodeAction,
  encodeObservation,
  encodeObservationFromUnits,
} from './observation.js';

const VERSION = 1;
const SEED = 42;

const buildA = {
  name: 'Observation A',
  units: [
    {
      roleId: 'vanguard',
      skillIds: ['shield-bash', 'guardian-ward'],
      behaviorId: 'protect-allies',
      position: { x: 100, y: 100 },
    },
    {
      roleId: 'reaver',
      skillIds: ['cleave'],
      behaviorId: 'aggro-lowest-hp',
      position: { x: 120, y: 100 },
    },
  ],
};

const buildB = {
  name: 'Observation B',
  units: [
    {
      roleId: 'mender',
      skillIds: ['mending-touch'],
      behaviorId: 'protect-allies',
      position: { x: 400, y: 100 },
    },
  ],
};

describe('OBS_ENCODING_VERSION', () => {
  it('is pinned to 2', () => {
    expect(OBS_ENCODING_VERSION).toBe(2);
  });

  // Ratchet: growing the skill catalog grows OBS_SELF_FIELD_COUNT (one
  // cooldown slot per catalog skill), which is itself an encoding-layout
  // change and therefore a breaking migration (see observation.ts's module
  // doc comment). Add a mapping row here whenever the catalog grows, so a
  // catalog change without a matching OBS_ENCODING_VERSION bump goes RED.
  const OBS_VERSION_BY_CATALOG_SIZE: Record<number, number> = { 6: 1, 10: 2 };

  it('pins OBS_ENCODING_VERSION to the current skill-catalog size', () => {
    const expected = OBS_VERSION_BY_CATALOG_SIZE[skillCatalog.length];
    expect(expected).toBeDefined(); // add a mapping row when you grow the catalog
    expect(OBS_ENCODING_VERSION).toBe(expected);
    expect(OBS_SELF_FIELD_COUNT).toBe(5 + skillCatalog.length);
  });
});

describe('encodeObservation', () => {
  it('throws for an unknown unit id', () => {
    const world = init(VERSION, SEED, buildA, buildB);
    expect(() => encodeObservation(world, 999)).toThrow(/999/);
  });

  it('produces a fixed-order vector: self block, then allies, then enemies, ascending id', () => {
    const world = init(VERSION, SEED, buildA, buildB);
    // ids: 0 = vanguard (A), 1 = reaver (A), 2 = mender (B)
    const vector = encodeObservation(world, 0);
    const self = world.units[0]!;
    const ally = world.units[1]!;
    const enemy = world.units[2]!;

    // Self block.
    expect(vector[OBS_SELF_HP_INDEX]).toBe(self.hp);
    expect(vector[OBS_SELF_MAX_HP_INDEX]).toBe(self.maxHp);
    expect(vector[OBS_SELF_POS_X_INDEX]).toBe(self.pos.x);
    expect(vector[OBS_SELF_POS_Y_INDEX]).toBe(self.pos.y);
    expect(vector[OBS_SELF_ATTACK_COOLDOWN_INDEX]).toBe(self.attackCooldownRemaining);

    // Per-catalog-skill cooldowns: shield-bash and guardian-ward are
    // equipped (cooldown 0, fresh spawn); every other catalog skill is the
    // "absent" sentinel (-1).
    for (const [catalogIndex, skill] of skillCatalog.entries()) {
      const slot = vector[OBS_SELF_SKILL_COOLDOWN_START_INDEX + catalogIndex];
      if (skill.id === 'shield-bash' || skill.id === 'guardian-ward') {
        expect(slot).toBe(0);
      } else {
        expect(slot).toBe(-1);
      }
    }

    // Ally block (id 1), immediately after the self block.
    const allyOffset = OBS_SELF_FIELD_COUNT;
    expect(vector.slice(allyOffset, allyOffset + OBS_UNIT_FIELD_COUNT)).toEqual([
      ally.id,
      ally.hp,
      ally.maxHp,
      ally.pos.x,
      ally.pos.y,
      (ally.pos.x - self.pos.x) ** 2 + (ally.pos.y - self.pos.y) ** 2,
    ]);

    // Enemy block (id 2), immediately after the (single) ally block.
    const enemyOffset = allyOffset + OBS_UNIT_FIELD_COUNT;
    expect(vector.slice(enemyOffset, enemyOffset + OBS_UNIT_FIELD_COUNT)).toEqual([
      enemy.id,
      enemy.hp,
      enemy.maxHp,
      enemy.pos.x,
      enemy.pos.y,
      (enemy.pos.x - self.pos.x) ** 2 + (enemy.pos.y - self.pos.y) ** 2,
    ]);

    expect(vector).toHaveLength(OBS_SELF_FIELD_COUNT + 2 * OBS_UNIT_FIELD_COUNT);
  });

  it('produces only integers (integer combat math)', () => {
    const world = init(VERSION, SEED, buildA, buildB);
    const vector = encodeObservation(world, 0);
    for (const value of vector) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('keeps a stable vector length across ticks even after a unit dies (dead units stay in the roster)', () => {
    const world = init(VERSION, SEED, buildA, buildB);
    const before = encodeObservation(world, 0).length;

    world.units[2]!.hp = 0; // kill the enemy directly; encodeObservation must not filter dead units out

    const after = encodeObservation(world, 0).length;
    expect(after).toBe(before);
  });
});

describe('encodeObservationFromUnits', () => {
  it('is what the public encodeObservation delegates to (behavior-preserving extraction)', () => {
    const world = init(VERSION, SEED, buildA, buildB);
    expect(encodeObservationFromUnits(world.units, 0)).toEqual(encodeObservation(world, 0));
  });

  it('throws for an unknown unit id, same as encodeObservation', () => {
    const world = init(VERSION, SEED, buildA, buildB);
    expect(() => encodeObservationFromUnits(world.units, 999)).toThrow(/999/);
  });
});

describe('encodeAction / decodeAction', () => {
  const cases: Action[] = [
    { kind: 'idle' },
    { kind: 'move', to: { x: 12, y: 34 } },
    { kind: 'move-toward', targetId: 7 },
    { kind: 'attack', targetId: 3 },
    { kind: 'cast', skillId: 'frost-bolt', targetId: 5 },
  ];

  it.each(cases)('round-trips %o', (action) => {
    const encoded = encodeAction(action);
    expect(encoded).toHaveLength(4);
    expect(decodeAction(encoded)).toEqual(action);
  });

  it('encodes every action kind as a distinct integer tag', () => {
    const tags = new Set(cases.map((action) => encodeAction(action)[0]));
    expect(tags.size).toBe(cases.length);
  });

  it('throws for an unknown skillId', () => {
    expect(() => encodeAction({ kind: 'cast', skillId: 'nonexistent', targetId: 0 })).toThrow(
      /nonexistent/,
    );
  });

  it('throws when decoding a tuple of the wrong length', () => {
    expect(() => decodeAction([0, 0, 0])).toThrow(/length/);
  });

  it('throws when decoding an unknown kind code', () => {
    expect(() => decodeAction([99, 0, 0, 0])).toThrow(/99/);
  });

  it('throws when decoding an out-of-range skill index', () => {
    expect(() => decodeAction([4, 0, 0, 999])).toThrow(/999/);
  });

  it('throws when a slot the kind does not use is non-zero', () => {
    // idle uses no slots; move uses p1/p2 only; move-toward and attack use
    // p1 only; cast uses p1 and p3 only. [2, 7, 9, 9] (move-toward with a
    // stray non-zero p2 and p3) must be rejected, not silently ignored, per
    // the #63 review: unused slots are a wire contract, not padding.
    expect(() => decodeAction([0, 1, 0, 0])).toThrow(/unused/);
    expect(() => decodeAction([0, 0, 1, 0])).toThrow(/unused/);
    expect(() => decodeAction([0, 0, 0, 1])).toThrow(/unused/);
    expect(() => decodeAction([1, 12, 34, 1])).toThrow(/unused/);
    expect(() => decodeAction([2, 7, 9, 9])).toThrow(/unused/);
    expect(() => decodeAction([3, 3, 1, 0])).toThrow(/unused/);
    expect(() => decodeAction([3, 3, 0, 1])).toThrow(/unused/);
    expect(() => decodeAction([4, 5, 1, 0])).toThrow(/unused/);
  });
});
