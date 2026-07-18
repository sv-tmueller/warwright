from __future__ import annotations

import pytest

from warwright_gym.actions import SKILL_CATALOG, decode_action, encode_action

ACTION_CASES = [
    {"kind": "idle"},
    {"kind": "move", "to": {"x": 12, "y": 34}},
    {"kind": "move-toward", "targetId": 7},
    {"kind": "attack", "targetId": 3},
    {"kind": "cast", "skillId": "frost-bolt", "targetId": 5},
]


@pytest.mark.parametrize("action", ACTION_CASES)
def test_round_trips(action):
    encoded = encode_action(action)
    assert len(encoded) == 4
    assert decode_action(encoded) == action


def test_every_action_kind_has_a_distinct_tag():
    tags = {encode_action(action)[0] for action in ACTION_CASES}
    assert len(tags) == len(ACTION_CASES)


def test_cast_uses_the_skill_catalog_index():
    encoded = encode_action({"kind": "cast", "skillId": "frost-bolt", "targetId": 5})
    assert encoded == [4, 5, 0, SKILL_CATALOG.index("frost-bolt")]


def test_encode_unknown_skill_id_raises():
    with pytest.raises(ValueError, match="nonexistent"):
        encode_action({"kind": "cast", "skillId": "nonexistent", "targetId": 0})


def test_decode_wrong_length_raises():
    with pytest.raises(ValueError, match="length"):
        decode_action([0, 0, 0])


def test_decode_unknown_kind_code_raises():
    with pytest.raises(ValueError, match="99"):
        decode_action([99, 0, 0, 0])


def test_decode_out_of_range_skill_index_raises():
    with pytest.raises(ValueError, match="999"):
        decode_action([4, 0, 0, 999])


@pytest.mark.parametrize(
    "encoded",
    [
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
        [1, 12, 34, 1],
        [2, 7, 9, 9],
        [3, 3, 1, 0],
        [3, 3, 0, 1],
        [4, 5, 1, 0],
    ],
)
def test_decode_rejects_non_zero_unused_slots(encoded):
    with pytest.raises(ValueError, match="unused"):
        decode_action(encoded)
