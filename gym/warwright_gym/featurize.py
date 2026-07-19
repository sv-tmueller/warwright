"""Stateless int64 -> float32 featurization for a raw observation vector
(#127). This is a pure projection applied inside a training/eval loop --
part of the POLICY contract, never an env wrapper: `RewardShapingWrapper`
(warwright_gym.rewards) always sees the RAW integer observation so its hp
deltas stay exact.

Every field is scaled by a FIXED, field-class-specific power-of-two
divisor:

    hp / maxHp        -> HP_DIVISOR (1024)
    x / y              -> POS_DIVISOR (1024)
    cooldowns          -> COOLDOWN_DIVISOR (64), `-1` (SKILL_COOLDOWN_ABSENT)
                          passed through UNCHANGED, never divided
    distance squared    -> DISTANCE_SQUARED_DIVISOR (2**21)
    unit id             -> unscaled (divisor 1): not a magnitude value, kept
                          only so the output vector's shape/index alignment
                          matches the raw observation; a policy should not
                          treat it as a meaningful numeric feature.

Power-of-two divisors are EXACT in binary floating point (for any value
whose magnitude fits the mantissa, which every field here does): this is
deliberate so a future float64 TS inference Behavior (#66, per CLAUDE.md's
"Content, learned behaviors, and cosmetics") can mirror this exact map
bit-for-bit. NEVER change a divisor to a non-power-of-two value or replace
this with running-statistics normalization -- see gym/ENCODING.md's
featurize addendum.

The per-index field class is derived from warwright_gym.observation's
layout constants (self block once, then one unit block per ally/enemy),
never a hardcoded magic layout -- see `field_classes_for_length`.
"""

from __future__ import annotations

from enum import Enum, auto

import numpy as np

from warwright_gym.observation import (
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
)

HP_DIVISOR = 1024
POS_DIVISOR = 1024
COOLDOWN_DIVISOR = 64
DISTANCE_SQUARED_DIVISOR = 2**21


class FieldClass(Enum):
    """One entry per raw-observation field class `featurize` treats
    distinctly. See the module docstring for the divisor each maps to."""

    ID = auto()
    HP = auto()
    POS = auto()
    COOLDOWN = auto()
    DISTANCE_SQUARED = auto()


_DIVISORS: dict[FieldClass, int] = {
    FieldClass.ID: 1,
    FieldClass.HP: HP_DIVISOR,
    FieldClass.POS: POS_DIVISOR,
    FieldClass.COOLDOWN: COOLDOWN_DIVISOR,
    FieldClass.DISTANCE_SQUARED: DISTANCE_SQUARED_DIVISOR,
}


def _self_block_field_classes() -> list[FieldClass]:
    classes = [FieldClass.COOLDOWN] * OBS_SELF_FIELD_COUNT
    classes[OBS_SELF_HP_INDEX] = FieldClass.HP
    classes[OBS_SELF_MAX_HP_INDEX] = FieldClass.HP
    classes[OBS_SELF_POS_X_INDEX] = FieldClass.POS
    classes[OBS_SELF_POS_Y_INDEX] = FieldClass.POS
    classes[OBS_SELF_ATTACK_COOLDOWN_INDEX] = FieldClass.COOLDOWN
    # [OBS_SELF_SKILL_COOLDOWN_START_INDEX, OBS_SELF_FIELD_COUNT) already
    # defaulted to COOLDOWN above; this loop only makes that range explicit.
    for index in range(OBS_SELF_SKILL_COOLDOWN_START_INDEX, OBS_SELF_FIELD_COUNT):
        classes[index] = FieldClass.COOLDOWN
    return classes


def _unit_block_field_classes() -> list[FieldClass]:
    classes: list[FieldClass | None] = [None] * OBS_UNIT_FIELD_COUNT
    classes[OBS_UNIT_ID_OFFSET] = FieldClass.ID
    classes[OBS_UNIT_HP_OFFSET] = FieldClass.HP
    classes[OBS_UNIT_MAX_HP_OFFSET] = FieldClass.HP
    classes[OBS_UNIT_POS_X_OFFSET] = FieldClass.POS
    classes[OBS_UNIT_POS_Y_OFFSET] = FieldClass.POS
    classes[OBS_UNIT_DISTANCE_SQUARED_OFFSET] = FieldClass.DISTANCE_SQUARED
    assert all(field_class is not None for field_class in classes), (
        "_unit_block_field_classes: every OBS_UNIT_*_OFFSET slot must be assigned"
    )
    return classes  # type: ignore[return-value]


def field_classes_for_length(length: int) -> list[FieldClass]:
    """The `FieldClass` for every index of a raw observation vector of the
    given `length`: one self block (`OBS_SELF_FIELD_COUNT`-wide) followed by
    a whole number of unit blocks (`OBS_UNIT_FIELD_COUNT`-wide each), per
    warwright_gym.observation's layout. Fails loud on a length that does not
    decompose that way (a desynced encoder, not a valid observation)."""
    if length < OBS_SELF_FIELD_COUNT:
        raise ValueError(
            f"field_classes_for_length: length {length} is shorter than the self "
            f"block ({OBS_SELF_FIELD_COUNT})"
        )
    remainder = length - OBS_SELF_FIELD_COUNT
    if remainder % OBS_UNIT_FIELD_COUNT != 0:
        raise ValueError(
            f"field_classes_for_length: length {length} does not decompose into a "
            f"self block ({OBS_SELF_FIELD_COUNT}) plus a whole number of unit blocks "
            f"({OBS_UNIT_FIELD_COUNT} each)"
        )
    num_unit_blocks = remainder // OBS_UNIT_FIELD_COUNT

    classes = _self_block_field_classes()
    unit_block_classes = _unit_block_field_classes()
    for _ in range(num_unit_blocks):
        classes.extend(unit_block_classes)
    return classes


def featurize(observation: np.ndarray) -> np.ndarray:
    """Project a raw int64 observation (or a batch, shape `(..., L)`) to
    float32 using the fixed power-of-two divisor for each index's field
    class. Stateless: the same input always maps to the same output, no
    running statistics are kept."""
    observation = np.asarray(observation)
    length = observation.shape[-1]
    classes = field_classes_for_length(length)

    divisors = np.array([_DIVISORS[field_class] for field_class in classes], dtype=np.float32)
    featurized = observation.astype(np.float32) / divisors

    cooldown_mask = np.array([field_class == FieldClass.COOLDOWN for field_class in classes])
    sentinel_mask = cooldown_mask & (observation == SKILL_COOLDOWN_ABSENT)
    featurized = np.where(sentinel_mask, np.float32(SKILL_COOLDOWN_ABSENT), featurized)

    return featurized.astype(np.float32)
