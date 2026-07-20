"""Unit tests for warwright_gym.training.export_policy (#131): the
checkpoint -> committed weights-JSON conversion (actor only, float32
exactness, bit-exact round trip) and the parity-fixture case builder's
near-tie margin filter. No bridge/env here -- see
gym/tests/test_inference_parity_fixture.py for the SYNC test that checks
the actually-committed artifacts, and EXPORT.md for the one recorded
export run that produced them.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

pytest.importorskip("torch")

import torch

from warwright_gym.observation import (
    OBS_SELF_FIELD_COUNT,
    OBS_SELF_SKILL_COOLDOWN_START_INDEX,
    OBS_UNIT_FIELD_COUNT,
    OBS_UNIT_HP_OFFSET,
    OBS_UNIT_MAX_HP_OFFSET,
    SKILL_COOLDOWN_ABSENT,
)
from warwright_gym.training.export_policy import (
    BEHAVIOR_ID,
    MARGIN_EPSILON,
    OBS_ENCODING_VERSION,
    assert_enough_cases,
    build_fixture_case,
    compute_action_and_margins,
    dedupe_observations,
    filter_cases_by_margin,
    generate_weights_and_fixture,
    hand_built_edge_case_observations,
    policy_to_weights_json,
    sha256_hex,
    weights_json_to_policy,
)
from warwright_gym.training.policy import ActorCriticPolicy

OBS_DIM = OBS_SELF_FIELD_COUNT + OBS_UNIT_FIELD_COUNT  # one enemy, no allies
NVEC = [5, 1, 6, 1001, 1001]


def _policy(seed: int = 0) -> ActorCriticPolicy:
    torch.manual_seed(seed)
    return ActorCriticPolicy(obs_dim=OBS_DIM, nvec=NVEC)


def _obs_row(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    row = rng.integers(0, 500, size=OBS_DIM, dtype=np.int64)
    # every skill cooldown slot the unit doesn't have equipped is the -1
    # sentinel, never a real magnitude -- keep this realistic.
    row[OBS_SELF_SKILL_COOLDOWN_START_INDEX : OBS_SELF_FIELD_COUNT] = SKILL_COOLDOWN_ABSENT
    return row


def test_policy_to_weights_json_has_the_documented_shape():
    policy = _policy()
    weights = policy_to_weights_json(policy)

    assert weights["formatVersion"] == 1
    assert weights["behaviorId"] == BEHAVIOR_ID
    assert weights["obsEncodingVersion"] == OBS_ENCODING_VERSION
    assert weights["obsDim"] == OBS_DIM
    assert weights["nvec"] == NVEC
    assert weights["hidden"] == [64, 64]
    for layer_name, in_features, out_features in (
        ("trunk1", OBS_DIM, 64),
        ("trunk2", 64, 64),
        ("actorHead", 64, sum(NVEC)),
    ):
        layer = weights[layer_name]
        assert len(layer["weight"]) == out_features
        assert len(layer["weight"][0]) == in_features
        assert len(layer["bias"]) == out_features
    assert "critic_head" not in weights
    assert "criticHead" not in weights


def test_policy_to_weights_json_floats_are_exactly_float32_representable():
    policy = _policy(seed=3)
    weights = policy_to_weights_json(policy)

    for layer_name in ("trunk1", "trunk2", "actorHead"):
        for value in weights[layer_name]["bias"]:
            assert float(np.float32(value)) == value
        for row in weights[layer_name]["weight"]:
            for value in row:
                assert float(np.float32(value)) == value


def test_weights_json_round_trips_through_json_dumps_and_reload_to_identical_logits():
    policy = _policy(seed=7)
    weights = policy_to_weights_json(policy)
    reloaded_weights = json.loads(json.dumps(weights))

    reconstructed = weights_json_to_policy(reloaded_weights)

    obs = torch.randn((5, OBS_DIM), dtype=torch.float32)
    original_logits = policy.actor_logits(obs)
    reconstructed_logits = reconstructed.actor_logits(obs)

    for original, reconstructed_component in zip(
        original_logits, reconstructed_logits, strict=True
    ):
        assert torch.equal(original, reconstructed_component)


def test_weights_json_to_policy_reconstructs_expected_shapes():
    policy = _policy(seed=1)
    weights = policy_to_weights_json(policy)

    reconstructed = weights_json_to_policy(weights)

    assert reconstructed.obs_dim == OBS_DIM
    assert reconstructed.nvec == NVEC


def test_compute_action_and_margins_returns_one_component_per_nvec_entry():
    policy = _policy(seed=2)
    obs = _obs_row(seed=2)

    action, margins = compute_action_and_margins(policy, obs)

    assert len(action) == len(NVEC)
    assert len(margins) == len(NVEC)
    for component_action, bound in zip(action, NVEC, strict=True):
        assert 0 <= component_action < bound


def test_compute_action_and_margins_single_option_component_has_infinite_margin():
    # NVEC[1] (target_slot) is 1-way for this 1-enemy build -- no second
    # option to be a near-tie with.
    policy = _policy(seed=2)
    obs = _obs_row(seed=2)

    _action, margins = compute_action_and_margins(policy, obs)

    assert margins[1] == float("inf")


def test_build_fixture_case_has_the_documented_shape():
    policy = _policy(seed=4)
    obs = _obs_row(seed=4)

    case = build_fixture_case(policy, obs)

    assert case["obs"] == [int(v) for v in obs.tolist()]
    assert len(case["action"]) == len(NVEC)
    assert isinstance(case["minMargin"], float)


def test_filter_cases_by_margin_drops_near_ties():
    cases = [
        {"minMargin": 0.5},
        {"minMargin": MARGIN_EPSILON},  # exactly at the threshold: kept
        {"minMargin": MARGIN_EPSILON - 1e-6},  # just under: dropped
        {"minMargin": 0.0},
    ]

    surviving = filter_cases_by_margin(cases, MARGIN_EPSILON)

    assert surviving == [cases[0], cases[1]]


def test_assert_enough_cases_raises_when_too_few_survive():
    with pytest.raises(RuntimeError):
        assert_enough_cases([{"minMargin": 1.0}], minimum=2)


def test_assert_enough_cases_does_not_raise_when_enough_survive():
    assert_enough_cases([{"minMargin": 1.0}, {"minMargin": 1.0}], minimum=2)


def test_dedupe_observations_drops_exact_duplicates_preserving_order():
    a = _obs_row(seed=1)
    b = _obs_row(seed=2)
    a_again = a.copy()

    deduped = dedupe_observations([a, b, a_again])

    assert len(deduped) == 2
    assert np.array_equal(deduped[0], a)
    assert np.array_equal(deduped[1], b)


def test_hand_built_edge_case_observations_preserve_length_and_vary_the_template():
    template = _obs_row(seed=9)

    variants = hand_built_edge_case_observations(template)

    assert len(variants) >= 3
    for variant in variants:
        assert variant.shape == template.shape
        assert variant.dtype == template.dtype
    # at least one variant actually differs from the template (otherwise
    # these aren't edge cases at all)
    assert any(not np.array_equal(variant, template) for variant in variants)


def test_hand_built_edge_case_observations_include_a_skill_on_cooldown_case():
    template = _obs_row(seed=9)
    cleave_slot = OBS_SELF_SKILL_COOLDOWN_START_INDEX + 2  # "cleave" catalog index
    template[cleave_slot] = 0  # skill ready in the template

    variants = hand_built_edge_case_observations(template)

    assert any(variant[cleave_slot] > 0 for variant in variants)


def test_hand_built_edge_case_observations_include_a_low_enemy_hp_case():
    template = _obs_row(seed=9)
    enemy_hp_index = OBS_SELF_FIELD_COUNT + OBS_UNIT_HP_OFFSET
    enemy_max_hp_index = OBS_SELF_FIELD_COUNT + OBS_UNIT_MAX_HP_OFFSET
    template[enemy_max_hp_index] = 100
    template[enemy_hp_index] = 100

    variants = hand_built_edge_case_observations(template)

    assert any(variant[enemy_hp_index] == 1 for variant in variants)


def test_build_fixture_case_raises_when_every_component_has_an_infinite_margin(monkeypatch):
    # Unreachable with the current nvec (target_slot is the only 1-way
    # component), but `json.dumps(float("inf"))` emits the non-standard
    # `Infinity` token, which TS `JSON.parse` rejects -- fail loud instead
    # of silently writing a non-strictly-JSON artifact.
    policy = _policy(seed=5)
    obs = _obs_row(seed=5)

    def _all_infinite_margins(_policy, _obs):
        return [0, 0, 0, 0, 0], [float("inf")] * len(NVEC)

    monkeypatch.setattr(
        "warwright_gym.training.export_policy.compute_action_and_margins",
        _all_infinite_margins,
    )

    with pytest.raises(ValueError, match="minMargin"):
        build_fixture_case(policy, obs)


def test_generate_weights_and_fixture_weights_json_path_raises_on_stale_obs_encoding_version(
    tmp_path,
):
    stale_weights_path = tmp_path / "stale-weights.json"
    stale_weights_path.write_text(
        json.dumps({"obsEncodingVersion": OBS_ENCODING_VERSION + 1, "behaviorId": BEHAVIOR_ID})
    )

    with pytest.raises(ValueError, match="obsEncodingVersion"):
        generate_weights_and_fixture(
            weights_json_path=stale_weights_path,
            weights_out=tmp_path / "weights-out.json",
            fixture_out=tmp_path / "fixture-out.json",
        )


def test_sha256_hex_matches_hashlib():
    import hashlib

    data = b"some committed weights json bytes"
    assert sha256_hex(data) == hashlib.sha256(data).hexdigest()
