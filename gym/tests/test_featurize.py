"""Unit tests for warwright_gym.featurize (#127): a stateless int64 ->
float32 map with FIXED power-of-two divisors per field class. No bridge, no
Transport -- pure arithmetic over hand-built observation vectors shaped per
warwright_gym.observation's layout constants.
"""

from __future__ import annotations

import numpy as np
import pytest

from warwright_gym.featurize import (
    COOLDOWN_DIVISOR,
    DISTANCE_SQUARED_DIVISOR,
    HP_DIVISOR,
    POS_DIVISOR,
    featurize,
)
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
    compute_observation_length,
)


def _self_block(hp=500, max_hp=1024, x=256, y=512, attack_cooldown=130, skill_cooldowns=None):
    block = [SKILL_COOLDOWN_ABSENT] * OBS_SELF_FIELD_COUNT
    block[OBS_SELF_HP_INDEX] = hp
    block[OBS_SELF_MAX_HP_INDEX] = max_hp
    block[OBS_SELF_POS_X_INDEX] = x
    block[OBS_SELF_POS_Y_INDEX] = y
    block[OBS_SELF_ATTACK_COOLDOWN_INDEX] = attack_cooldown
    if skill_cooldowns is not None:
        for offset, value in skill_cooldowns.items():
            block[OBS_SELF_SKILL_COOLDOWN_START_INDEX + offset] = value
    return block


def _unit_block(unit_id, hp, max_hp, x, y, dist_squared):
    block = [0] * OBS_UNIT_FIELD_COUNT
    block[OBS_UNIT_ID_OFFSET] = unit_id
    block[OBS_UNIT_HP_OFFSET] = hp
    block[OBS_UNIT_MAX_HP_OFFSET] = max_hp
    block[OBS_UNIT_POS_X_OFFSET] = x
    block[OBS_UNIT_POS_Y_OFFSET] = y
    block[OBS_UNIT_DISTANCE_SQUARED_OFFSET] = dist_squared
    return block


def test_divisors_are_the_documented_powers_of_two():
    assert HP_DIVISOR == 1024
    assert POS_DIVISOR == 1024
    assert COOLDOWN_DIVISOR == 64
    assert DISTANCE_SQUARED_DIVISOR == 2**21


def test_self_block_hp_and_pos_fields_divide_exactly():
    observation = np.array(_self_block(hp=500, max_hp=1024, x=256, y=512), dtype=np.int64)
    result = featurize(observation)

    assert result.dtype == np.float32
    assert result[OBS_SELF_HP_INDEX] == np.float32(500 / 1024)
    assert result[OBS_SELF_MAX_HP_INDEX] == np.float32(1024 / 1024)
    assert result[OBS_SELF_POS_X_INDEX] == np.float32(256 / 1024)
    assert result[OBS_SELF_POS_Y_INDEX] == np.float32(512 / 1024)


def test_self_block_attack_cooldown_divides_by_cooldown_divisor():
    observation = np.array(_self_block(attack_cooldown=130), dtype=np.int64)
    result = featurize(observation)

    assert result[OBS_SELF_ATTACK_COOLDOWN_INDEX] == np.float32(130 / 64)


def test_self_block_skill_cooldown_absent_sentinel_is_passed_through_unchanged():
    observation = np.array(
        _self_block(skill_cooldowns={0: SKILL_COOLDOWN_ABSENT, 1: 64}), dtype=np.int64
    )
    result = featurize(observation)

    absent_index = OBS_SELF_SKILL_COOLDOWN_START_INDEX
    present_index = OBS_SELF_SKILL_COOLDOWN_START_INDEX + 1
    assert result[absent_index] == np.float32(SKILL_COOLDOWN_ABSENT)
    assert result[present_index] == np.float32(64 / 64)


def test_unit_block_hp_maxhp_and_pos_divide_by_the_same_divisors_as_self():
    self_block = _self_block()
    unit_block = _unit_block(unit_id=7, hp=800, max_hp=1024, x=100, y=200, dist_squared=0)
    observation = np.array(self_block + unit_block, dtype=np.int64)
    result = featurize(observation)

    offset = OBS_SELF_FIELD_COUNT
    assert result[offset + OBS_UNIT_HP_OFFSET] == np.float32(800 / 1024)
    assert result[offset + OBS_UNIT_MAX_HP_OFFSET] == np.float32(1024 / 1024)
    assert result[offset + OBS_UNIT_POS_X_OFFSET] == np.float32(100 / 1024)
    assert result[offset + OBS_UNIT_POS_Y_OFFSET] == np.float32(200 / 1024)


def test_unit_block_distance_squared_divides_by_2_pow_21():
    self_block = _self_block()
    unit_block = _unit_block(unit_id=7, hp=0, max_hp=0, x=0, y=0, dist_squared=2**21)
    observation = np.array(self_block + unit_block, dtype=np.int64)
    result = featurize(observation)

    offset = OBS_SELF_FIELD_COUNT + OBS_UNIT_DISTANCE_SQUARED_OFFSET
    assert result[offset] == np.float32(1.0)


def test_shape_is_preserved_for_a_single_observation():
    length = compute_observation_length(num_allies=1, num_enemies=1)
    observation = np.zeros(length, dtype=np.int64)
    result = featurize(observation)

    assert result.shape == observation.shape


def test_shape_is_preserved_for_a_batch_of_observations():
    length = compute_observation_length(num_allies=0, num_enemies=2)
    observation = np.zeros((4, length), dtype=np.int64)
    result = featurize(observation)

    assert result.shape == observation.shape


def test_rejects_a_length_that_does_not_decompose_into_whole_unit_blocks():
    bad_length = OBS_SELF_FIELD_COUNT + OBS_UNIT_FIELD_COUNT + 1
    observation = np.zeros(bad_length, dtype=np.int64)

    with pytest.raises(ValueError, match="decompose"):
        featurize(observation)
