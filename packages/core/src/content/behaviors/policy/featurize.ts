// TS mirror of gym/warwright_gym/featurize.py -- see that module's
// docstring for the full rationale. A stateless int -> float64 map with a
// FIXED, field-class-specific power-of-two divisor per index:
//
//   hp / maxHp        -> HP_DIVISOR (1024)
//   x / y              -> POS_DIVISOR (1024)
//   cooldowns          -> COOLDOWN_DIVISOR (64); `-1`
//                         (sim/observation.ts's SKILL_COOLDOWN_ABSENT)
//                         passed through UNCHANGED, never divided
//   distance squared    -> DISTANCE_SQUARED_DIVISOR (2**21)
//   unit id             -> unscaled (divisor 1)
//
// Every divisor is a power of two so the division is exact in binary
// floating point -- this is deliberate, per gym/EXPORT.md's TS mirror
// contract: NEVER change a divisor to a non-power-of-two value or replace
// this with running-statistics normalization. The per-index field class is
// derived from sim/observation.ts's OBS_* layout constants, never a
// hardcoded magic layout -- see fieldClassesForLength.

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

export const HP_DIVISOR = 1024;
export const POS_DIVISOR = 1024;
export const COOLDOWN_DIVISOR = 64;
export const DISTANCE_SQUARED_DIVISOR = 2 ** 21;

// One entry per raw-observation field class featurize treats distinctly.
// See the module docstring for the divisor each maps to.
type FieldClass = 'id' | 'hp' | 'pos' | 'cooldown' | 'distanceSquared';

const DIVISORS: Record<FieldClass, number> = {
  id: 1,
  hp: HP_DIVISOR,
  pos: POS_DIVISOR,
  cooldown: COOLDOWN_DIVISOR,
  distanceSquared: DISTANCE_SQUARED_DIVISOR,
};

function selfBlockFieldClasses(): FieldClass[] {
  const classes = new Array<FieldClass>(OBS_SELF_FIELD_COUNT).fill('cooldown');
  classes[OBS_SELF_HP_INDEX] = 'hp';
  classes[OBS_SELF_MAX_HP_INDEX] = 'hp';
  classes[OBS_SELF_POS_X_INDEX] = 'pos';
  classes[OBS_SELF_POS_Y_INDEX] = 'pos';
  classes[OBS_SELF_ATTACK_COOLDOWN_INDEX] = 'cooldown';
  // [OBS_SELF_SKILL_COOLDOWN_START_INDEX, OBS_SELF_FIELD_COUNT) already
  // defaulted to 'cooldown' above; this loop only makes that range explicit,
  // mirroring featurize.py's _self_block_field_classes.
  for (let index = OBS_SELF_SKILL_COOLDOWN_START_INDEX; index < OBS_SELF_FIELD_COUNT; index += 1) {
    classes[index] = 'cooldown';
  }
  return classes;
}

function unitBlockFieldClasses(): FieldClass[] {
  const classes = new Array<FieldClass | undefined>(OBS_UNIT_FIELD_COUNT).fill(undefined);
  classes[OBS_UNIT_ID_OFFSET] = 'id';
  classes[OBS_UNIT_HP_OFFSET] = 'hp';
  classes[OBS_UNIT_MAX_HP_OFFSET] = 'hp';
  classes[OBS_UNIT_POS_X_OFFSET] = 'pos';
  classes[OBS_UNIT_POS_Y_OFFSET] = 'pos';
  classes[OBS_UNIT_DISTANCE_SQUARED_OFFSET] = 'distanceSquared';
  if (classes.some((fieldClass) => fieldClass === undefined)) {
    throw new Error('unitBlockFieldClasses: every OBS_UNIT_*_OFFSET slot must be assigned');
  }
  return classes as FieldClass[];
}

// The FieldClass for every index of a raw observation vector of the given
// `length`: one self block (OBS_SELF_FIELD_COUNT-wide) followed by a whole
// number of unit blocks (OBS_UNIT_FIELD_COUNT-wide each). Fails loud on a
// length that does not decompose that way (a desynced encoder, not a valid
// observation).
export function fieldClassesForLength(length: number): FieldClass[] {
  if (length < OBS_SELF_FIELD_COUNT) {
    throw new Error(
      `fieldClassesForLength: length ${length} is shorter than the self block (${OBS_SELF_FIELD_COUNT})`,
    );
  }
  const remainder = length - OBS_SELF_FIELD_COUNT;
  if (remainder % OBS_UNIT_FIELD_COUNT !== 0) {
    throw new Error(
      `fieldClassesForLength: length ${length} does not decompose into a self block ` +
        `(${OBS_SELF_FIELD_COUNT}) plus a whole number of unit blocks (${OBS_UNIT_FIELD_COUNT} each)`,
    );
  }
  const numUnitBlocks = remainder / OBS_UNIT_FIELD_COUNT;

  const classes = selfBlockFieldClasses();
  const unitClasses = unitBlockFieldClasses();
  for (let i = 0; i < numUnitBlocks; i += 1) {
    classes.push(...unitClasses);
  }
  return classes;
}

// Project a raw integer observation to float64 using the fixed power-of-two
// divisor for each index's field class. Stateless: the same input always
// maps to the same output, no running statistics are kept.
export function featurize(observation: readonly number[]): number[] {
  const classes = fieldClassesForLength(observation.length);

  return observation.map((value, index) => {
    const fieldClass = classes[index];
    // classes has exactly observation.length entries by construction above.
    if (fieldClass === undefined) {
      throw new Error(`featurize: no field class computed for index ${index}`);
    }
    if (fieldClass === 'cooldown' && value === SKILL_COOLDOWN_ABSENT) {
      return SKILL_COOLDOWN_ABSENT;
    }
    return value / DIVISORS[fieldClass];
  });
}
