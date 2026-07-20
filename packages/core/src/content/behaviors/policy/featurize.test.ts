// Mirrors gym/tests/test_featurize.py's cases -- see featurize.ts's
// docstring for why the divisor map and sentinel passthrough must stay
// bit-for-bit in sync with the Python source of truth.
import { describe, expect, it } from 'vitest';
import {
  OBS_SELF_ATTACK_COOLDOWN_INDEX,
  OBS_SELF_FIELD_COUNT,
  OBS_SELF_HP_INDEX,
  OBS_SELF_MAX_HP_INDEX,
  OBS_SELF_POS_X_INDEX,
  OBS_SELF_POS_Y_INDEX,
  OBS_SELF_SKILL_COOLDOWN_START_INDEX,
  OBS_UNIT_DISTANCE_SQUARED_OFFSET,
  OBS_UNIT_FIELD_COUNT,
  OBS_UNIT_HP_OFFSET,
  OBS_UNIT_ID_OFFSET,
  OBS_UNIT_MAX_HP_OFFSET,
  OBS_UNIT_POS_X_OFFSET,
  OBS_UNIT_POS_Y_OFFSET,
  SKILL_COOLDOWN_ABSENT,
} from '../../../sim/observation.js';
import {
  COOLDOWN_DIVISOR,
  DISTANCE_SQUARED_DIVISOR,
  HP_DIVISOR,
  POS_DIVISOR,
  featurize,
} from './featurize.js';

function selfBlock({
  hp = 500,
  maxHp = 1024,
  x = 256,
  y = 512,
  attackCooldown = 130,
  skillCooldowns = {},
}: {
  hp?: number;
  maxHp?: number;
  x?: number;
  y?: number;
  attackCooldown?: number;
  skillCooldowns?: Record<number, number>;
} = {}): number[] {
  const block = new Array<number>(OBS_SELF_FIELD_COUNT).fill(SKILL_COOLDOWN_ABSENT);
  block[OBS_SELF_HP_INDEX] = hp;
  block[OBS_SELF_MAX_HP_INDEX] = maxHp;
  block[OBS_SELF_POS_X_INDEX] = x;
  block[OBS_SELF_POS_Y_INDEX] = y;
  block[OBS_SELF_ATTACK_COOLDOWN_INDEX] = attackCooldown;
  for (const [offset, value] of Object.entries(skillCooldowns)) {
    block[OBS_SELF_SKILL_COOLDOWN_START_INDEX + Number(offset)] = value;
  }
  return block;
}

function unitBlock(unitId: number, hp: number, maxHp: number, x: number, y: number, distSquared: number): number[] {
  const block = new Array<number>(OBS_UNIT_FIELD_COUNT).fill(0);
  block[OBS_UNIT_ID_OFFSET] = unitId;
  block[OBS_UNIT_HP_OFFSET] = hp;
  block[OBS_UNIT_MAX_HP_OFFSET] = maxHp;
  block[OBS_UNIT_POS_X_OFFSET] = x;
  block[OBS_UNIT_POS_Y_OFFSET] = y;
  block[OBS_UNIT_DISTANCE_SQUARED_OFFSET] = distSquared;
  return block;
}

describe('featurize divisors', () => {
  it('are the documented powers of two', () => {
    expect(HP_DIVISOR).toBe(1024);
    expect(POS_DIVISOR).toBe(1024);
    expect(COOLDOWN_DIVISOR).toBe(64);
    expect(DISTANCE_SQUARED_DIVISOR).toBe(2 ** 21);
  });
});

describe('featurize', () => {
  it('divides self-block hp and pos fields by their divisor', () => {
    const observation = selfBlock({ hp: 500, maxHp: 1024, x: 256, y: 512 });
    const result = featurize(observation);

    expect(result[OBS_SELF_HP_INDEX]).toBe(500 / 1024);
    expect(result[OBS_SELF_MAX_HP_INDEX]).toBe(1024 / 1024);
    expect(result[OBS_SELF_POS_X_INDEX]).toBe(256 / 1024);
    expect(result[OBS_SELF_POS_Y_INDEX]).toBe(512 / 1024);
  });

  it('divides the self-block attack cooldown by the cooldown divisor', () => {
    const observation = selfBlock({ attackCooldown: 130 });
    const result = featurize(observation);

    expect(result[OBS_SELF_ATTACK_COOLDOWN_INDEX]).toBe(130 / 64);
  });

  it('passes the -1 absent-cooldown sentinel through unchanged, never divided', () => {
    const observation = selfBlock({ skillCooldowns: { 0: SKILL_COOLDOWN_ABSENT, 1: 64 } });
    const result = featurize(observation);

    const absentIndex = OBS_SELF_SKILL_COOLDOWN_START_INDEX;
    const presentIndex = OBS_SELF_SKILL_COOLDOWN_START_INDEX + 1;
    expect(result[absentIndex]).toBe(SKILL_COOLDOWN_ABSENT);
    expect(result[presentIndex]).toBe(64 / 64);
  });

  it('divides unit-block hp/maxHp/pos by the same divisors as the self block', () => {
    const observation = [...selfBlock(), ...unitBlock(7, 800, 1024, 100, 200, 0)];
    const result = featurize(observation);

    const offset = OBS_SELF_FIELD_COUNT;
    expect(result[offset + OBS_UNIT_HP_OFFSET]).toBe(800 / 1024);
    expect(result[offset + OBS_UNIT_MAX_HP_OFFSET]).toBe(1024 / 1024);
    expect(result[offset + OBS_UNIT_POS_X_OFFSET]).toBe(100 / 1024);
    expect(result[offset + OBS_UNIT_POS_Y_OFFSET]).toBe(200 / 1024);
  });

  it('leaves the unit id unscaled (divisor 1)', () => {
    const observation = [...selfBlock(), ...unitBlock(7, 0, 0, 0, 0, 0)];
    const result = featurize(observation);

    expect(result[OBS_SELF_FIELD_COUNT + OBS_UNIT_ID_OFFSET]).toBe(7);
  });

  it('divides distance-squared by 2**21', () => {
    const observation = [...selfBlock(), ...unitBlock(7, 0, 0, 0, 0, 2 ** 21)];
    const result = featurize(observation);

    const offset = OBS_SELF_FIELD_COUNT + OBS_UNIT_DISTANCE_SQUARED_OFFSET;
    expect(result[offset]).toBe(1.0);
  });

  it('preserves vector length', () => {
    const observation = [...selfBlock(), ...unitBlock(1, 0, 0, 0, 0, 0), ...unitBlock(2, 0, 0, 0, 0, 0)];
    const result = featurize(observation);

    expect(result).toHaveLength(observation.length);
  });

  it('throws on a length that does not decompose into whole unit blocks', () => {
    const badLength = OBS_SELF_FIELD_COUNT + OBS_UNIT_FIELD_COUNT + 1;
    const observation = new Array<number>(badLength).fill(0);

    expect(() => featurize(observation)).toThrow(/decompose/);
  });

  it('throws on a length shorter than the self block', () => {
    expect(() => featurize([0, 0])).toThrow(/self block/);
  });
});
