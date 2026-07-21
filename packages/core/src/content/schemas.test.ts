import { describe, expect, it } from 'vitest';
import { EFFECT_KINDS, STATUS_KINDS } from '../sim/vocab.js';
import type { EffectKind, StatusKind } from '../sim/vocab.js';
import {
  AugmentSchema,
  RoleSchema,
  SkillSchema,
  UnitBuildSchema,
  WarbandSchema,
  parseAugment,
  parseRole,
  parseSkill,
  parseWarband,
} from './schemas.js';

const validRole = {
  id: 'warrior',
  name: 'Warrior',
  maxHp: 100,
  armor: 5,
  moveSpeed: 3,
  attack: { damage: 10, rangeSquared: 400, cooldownTicks: 20 },
};

// One valid skill fixture per EFFECT_KINDS entry.
const skillFixturesByEffectKind: Record<EffectKind, unknown> = {
  'direct-damage': {
    id: 'fireball',
    name: 'Fireball',
    cooldownTicks: 40,
    rangeSquared: 900,
    target: 'enemy',
    effect: { kind: 'direct-damage', amount: 20 },
  },
  heal: {
    id: 'heal',
    name: 'Heal',
    cooldownTicks: 60,
    rangeSquared: 400,
    target: 'ally',
    effect: { kind: 'heal', amount: 15 },
  },
  'apply-status': {
    id: 'chill',
    name: 'Chill',
    cooldownTicks: 30,
    rangeSquared: 100,
    target: 'enemy',
    effect: { kind: 'apply-status', status: 'slow', durationTicks: 40, magnitude: 2 },
  },
};

function skillWithStatus(status: StatusKind) {
  return {
    id: `status-${status}`,
    name: `Status ${status}`,
    cooldownTicks: 30,
    rangeSquared: 100,
    target: 'enemy',
    effect: { kind: 'apply-status', status, durationTicks: 40, magnitude: 2 },
  };
}

const validUnitBuild = {
  roleId: 'warrior',
  skillIds: ['fireball'],
  behaviorId: 'aggressive',
  position: { x: 10, y: 20 },
};

const validWarband = {
  name: 'Alpha Squad',
  units: [
    validUnitBuild,
    {
      roleId: 'healer',
      skillIds: ['heal'],
      behaviorId: 'defensive',
      position: { x: 900, y: 900 },
    },
  ],
};

describe('RoleSchema', () => {
  it('parses a complete Role and round-trips its values', () => {
    const parsed = RoleSchema.parse(validRole);
    expect(parsed).toEqual(validRole);
  });

  it('rejects an unknown extra key (strict object)', () => {
    const withExtra = { ...validRole, unknownField: 'nope' };
    expect(() => RoleSchema.parse(withExtra)).toThrow();
  });
});

describe('SkillSchema', () => {
  it.each(EFFECT_KINDS)('parses a valid skill fixture for effect kind %s', (kind) => {
    const fixture = skillFixturesByEffectKind[kind];
    expect(() => SkillSchema.parse(fixture)).not.toThrow();
  });

  it.each(STATUS_KINDS)('parses an apply-status skill for status kind %s', (status) => {
    const fixture = skillWithStatus(status);
    expect(() => SkillSchema.parse(fixture)).not.toThrow();
  });

  it('rejects an unknown effect kind', () => {
    const invalid = {
      id: 'knockback-skill',
      name: 'Knockback',
      cooldownTicks: 10,
      rangeSquared: 100,
      target: 'enemy',
      effect: { kind: 'knockback', amount: 5 },
    };
    expect(() => SkillSchema.parse(invalid)).toThrow();
  });

  it('rejects a negative cooldownTicks', () => {
    const invalid = {
      ...(skillFixturesByEffectKind['direct-damage'] as object),
      cooldownTicks: -1,
    };
    expect(() => SkillSchema.parse(invalid)).toThrow();
  });

  it('rejects a skill fixture missing id', () => {
    const withoutId: Record<string, unknown> = {
      ...(skillFixturesByEffectKind['direct-damage'] as Record<string, unknown>),
    };
    delete withoutId.id;
    expect(() => parseSkill(withoutId)).toThrow(/missing skill id|id/i);
  });

  it('rejects a non-integer rangeSquared', () => {
    const invalid = {
      ...(skillFixturesByEffectKind['direct-damage'] as object),
      rangeSquared: 12.5,
    };
    expect(() => SkillSchema.parse(invalid)).toThrow();
  });
});

describe('UnitBuildSchema / WarbandSchema', () => {
  it('parses a warband with two unit builds', () => {
    const parsed = WarbandSchema.parse(validWarband);
    expect(parsed.units).toHaveLength(2);
  });

  it('rejects a unit build with a position outside arena bounds', () => {
    const invalid = {
      ...validWarband,
      units: [{ ...validUnitBuild, position: { x: 1001, y: 20 } }],
    };
    expect(() => WarbandSchema.parse(invalid)).toThrow();
  });
});

describe('parseRole', () => {
  it('returns a parsed Role for valid data', () => {
    expect(parseRole(validRole)).toEqual(validRole);
  });

  it('throws a descriptive error for invalid data', () => {
    expect(() => parseRole({ ...validRole, extra: true })).toThrow(/Role/);
  });
});

describe('parseSkill', () => {
  it('throws an Error whose message names the schema and the offending path', () => {
    const invalid = {
      ...(skillFixturesByEffectKind['direct-damage'] as object),
      rangeSquared: 12.5,
    };
    expect(() => parseSkill(invalid)).toThrow(/Skill/);
    expect(() => parseSkill(invalid)).toThrow(/rangeSquared/);
  });
});

describe('parseWarband', () => {
  it('returns a parsed Warband for valid data', () => {
    const parsed = parseWarband(validWarband);
    expect(parsed.name).toBe('Alpha Squad');
  });
});

const validAugment = {
  id: 'iron-plating',
  name: 'Iron Plating',
  armorDelta: 5,
};

describe('AugmentSchema', () => {
  it('parses a valid Augment with only armorDelta set', () => {
    const parsed = AugmentSchema.parse(validAugment);
    expect(parsed).toEqual(validAugment);
  });

  it('parses a valid Augment with all three deltas, including negative values', () => {
    const augment = {
      id: 'lopsided',
      name: 'Lopsided',
      maxHpDelta: -10,
      armorDelta: 2,
      moveSpeedDelta: -1,
    };
    expect(() => AugmentSchema.parse(augment)).not.toThrow();
  });

  it('parses a valid Augment with no deltas set at all', () => {
    const augment = { id: 'no-op', name: 'No-op' };
    expect(() => AugmentSchema.parse(augment)).not.toThrow();
  });

  it('rejects an unknown extra key (strict object)', () => {
    const withExtra = { ...validAugment, unknownField: 'nope' };
    expect(() => AugmentSchema.parse(withExtra)).toThrow();
  });

  it('rejects a non-integer delta', () => {
    const invalid = { ...validAugment, armorDelta: 5.5 };
    expect(() => AugmentSchema.parse(invalid)).toThrow();
  });

  it('rejects a missing id', () => {
    const withoutId: Record<string, unknown> = { ...validAugment };
    delete withoutId.id;
    expect(() => AugmentSchema.parse(withoutId)).toThrow();
  });

  it('rejects a missing name', () => {
    const withoutName: Record<string, unknown> = { ...validAugment };
    delete withoutName.name;
    expect(() => AugmentSchema.parse(withoutName)).toThrow();
  });
});

describe('parseAugment', () => {
  it('returns a parsed Augment for valid data', () => {
    expect(parseAugment(validAugment)).toEqual(validAugment);
  });

  it('throws a descriptive error naming the schema for invalid data', () => {
    expect(() => parseAugment({ ...validAugment, extra: true })).toThrow(/Augment/);
  });
});

describe('UnitBuildSchema augmentIds', () => {
  it('defaults augmentIds to an empty array when absent', () => {
    const parsed = UnitBuildSchema.parse(validUnitBuild);
    expect(parsed.augmentIds).toEqual([]);
  });

  it('accepts an explicit list of augment ids', () => {
    const withAugments = { ...validUnitBuild, augmentIds: ['iron-plating'] };
    const parsed = UnitBuildSchema.parse(withAugments);
    expect(parsed.augmentIds).toEqual(['iron-plating']);
  });

  it('rejects a non-string augment id', () => {
    const invalid = { ...validUnitBuild, augmentIds: [42] };
    expect(() => UnitBuildSchema.parse(invalid)).toThrow();
  });

  it('round-trips through parse-of-parsed unchanged', () => {
    const withAugments = { ...validUnitBuild, augmentIds: ['iron-plating', 'iron-plating'] };
    const once = UnitBuildSchema.parse(withAugments);
    const twice = UnitBuildSchema.parse(once);
    expect(twice).toEqual(once);
  });
});
