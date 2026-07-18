"""Tests for warwright_gym.env's Gymnasium wrapper (#64). Exercises the real
core through the built gym-bridge (see conftest.py's `bridge_path` fixture),
never a mock -- the point of #64 is that reset()/step() drive the actual
deterministic engine.
"""

from __future__ import annotations

import numpy as np
import pytest
from gymnasium.utils.env_checker import check_env

from warwright_gym.actions import SKILL_CATALOG
from warwright_gym.env import (
    EXTERNAL_BEHAVIOR_ID,
    WarwrightEnv,
    WarwrightVectorEnv,
    default_build_a,
    default_build_b,
)
from warwright_gym.observation import (
    OBS_SELF_FIELD_COUNT,
    OBS_SELF_HP_INDEX,
    OBS_SELF_MAX_HP_INDEX,
    OBS_UNIT_FIELD_COUNT,
    OBS_UNIT_ID_OFFSET,
    compute_observation_length,
)

TICKS_PER_STEP = 20
# 320 * 20 = 6400 ticks, at least the core's MATCH_TICK_CAP (6000): every
# match reaches `done` (win, loss, or tick-cap draw) at or before that.
MAX_ROUNDS = 320


def _lone_external_build(position=None):
    return {
        "name": "Test A",
        "units": [
            {
                "roleId": "reaver",
                "skillIds": [],
                "behaviorId": EXTERNAL_BEHAVIOR_ID,
                "position": position or {"x": 0, "y": 0},
            }
        ],
    }


def _small_baseline_build():
    return {
        "name": "Test B",
        "units": [
            {
                "roleId": "mender",
                "skillIds": [],
                "behaviorId": "aggro-lowest-hp",
                "position": {"x": 10, "y": 0},
            },
            {
                "roleId": "warden",
                "skillIds": [],
                "behaviorId": "aggro-lowest-hp",
                "position": {"x": 20, "y": 0},
            },
        ],
    }


def _idle_action():
    return np.array([0, 0, 0, 0, 0], dtype=np.int64)


# --- Construction-time validation -----------------------------------------


def test_construction_requires_exactly_one_external_unit_in_build_a(bridge_path):
    build_a_no_external = {
        "name": "Bad A",
        "units": [
            {
                "roleId": "reaver",
                "skillIds": [],
                "behaviorId": "aggro-lowest-hp",
                "position": {"x": 0, "y": 0},
            }
        ],
    }
    with pytest.raises(ValueError, match="external"):
        WarwrightVectorEnv(
            1,
            build_a=build_a_no_external,
            build_b=_small_baseline_build(),
            bridge_path=bridge_path,
        )


def test_construction_rejects_more_than_one_external_unit_in_build_a(bridge_path):
    build_a_two_external = {
        "name": "Bad A",
        "units": [
            {
                "roleId": "reaver",
                "skillIds": [],
                "behaviorId": EXTERNAL_BEHAVIOR_ID,
                "position": {"x": 0, "y": 0},
            },
            {
                "roleId": "warden",
                "skillIds": [],
                "behaviorId": EXTERNAL_BEHAVIOR_ID,
                "position": {"x": 5, "y": 0},
            },
        ],
    }
    with pytest.raises(ValueError, match="external"):
        WarwrightVectorEnv(
            1,
            build_a=build_a_two_external,
            build_b=_small_baseline_build(),
            bridge_path=bridge_path,
        )


def test_construction_rejects_external_unit_in_build_b(bridge_path):
    build_b_with_external = {
        "name": "Bad B",
        "units": [
            {
                "roleId": "reaver",
                "skillIds": [],
                "behaviorId": EXTERNAL_BEHAVIOR_ID,
                "position": {"x": 10, "y": 0},
            }
        ],
    }
    with pytest.raises(ValueError, match="external"):
        WarwrightVectorEnv(
            1,
            build_a=_lone_external_build(),
            build_b=build_b_with_external,
            bridge_path=bridge_path,
        )


def test_default_builds_satisfy_the_one_external_unit_rule(bridge_path):
    # Should not raise; default_build_a/b ship a valid pair.
    env = WarwrightVectorEnv(1, bridge_path=bridge_path)
    try:
        assert default_build_a() is not None
        assert default_build_b() is not None
    finally:
        env.close()


# --- Observation/action spaces vs the actual reset frame -------------------


def test_observation_space_shape_matches_the_reset_frame(bridge_path):
    build_a = _lone_external_build()
    build_b = _small_baseline_build()
    env = WarwrightVectorEnv(2, build_a=build_a, build_b=build_b, bridge_path=bridge_path)
    try:
        expected_length = compute_observation_length(num_allies=0, num_enemies=2)
        assert env.single_observation_space.shape == (expected_length,)

        obs, info = env.reset(seed=1)
        assert obs.shape == (2, expected_length)
        assert obs in env.observation_space
        assert info["replay_seed"].shape == (2,)
    finally:
        env.close()


def test_action_space_shape_is_kind_target_skill_move_x_move_y(bridge_path):
    build_a = _lone_external_build()
    build_b = _small_baseline_build()
    env = WarwrightVectorEnv(1, build_a=build_a, build_b=build_b, bridge_path=bridge_path)
    try:
        # kind in [0,5), target_slot in [0, n_allies + n_enemies) = [0, 2),
        # skill_index in [0, len(SKILL_CATALOG)), move_x/move_y in [0, 1001).
        assert env.single_action_space.nvec.tolist() == [5, 2, len(SKILL_CATALOG), 1001, 1001]
    finally:
        env.close()


# --- Slot -> unit id mapping ------------------------------------------------


def test_target_slots_index_the_observation_unit_block_order(bridge_path):
    build_a = _lone_external_build()
    build_b = _small_baseline_build()
    env = WarwrightVectorEnv(1, build_a=build_a, build_b=build_b, bridge_path=bridge_path)
    try:
        obs, _info = env.reset(seed=3)
        vector = obs[0]
        # No allies (build_a has only the external unit); two enemies from
        # build_b, ascending id order (unit ids 1 then 2; id 0 is self).
        first_block_id = vector[OBS_SELF_FIELD_COUNT + OBS_UNIT_ID_OFFSET]
        second_block_id = vector[
            OBS_SELF_FIELD_COUNT + OBS_UNIT_FIELD_COUNT + OBS_UNIT_ID_OFFSET
        ]
        assert [first_block_id, second_block_id] == [1, 2]
        assert env._slot_to_unit_id == [1, 2]
    finally:
        env.close()


def test_target_slots_put_allies_before_enemies_both_ascending_id(bridge_path):
    # build_a: the external agent (id 0, self) plus one scripted ally (id
    # 1); build_b: two baseline enemies (ids 2, 3). The observation/slot
    # convention is allies-ascending-id THEN enemies-ascending-id -- every
    # other env test uses a lone-external build_a and only ever exercises
    # the enemy half of that contract.
    build_a = {
        "name": "Test A with ally",
        "units": [
            {
                "roleId": "reaver",
                "skillIds": [],
                "behaviorId": EXTERNAL_BEHAVIOR_ID,
                "position": {"x": 0, "y": 0},
            },
            {
                "roleId": "warden",
                "skillIds": [],
                "behaviorId": "aggro-lowest-hp",
                "position": {"x": 5, "y": 0},
            },
        ],
    }
    build_b = _small_baseline_build()
    env = WarwrightVectorEnv(1, build_a=build_a, build_b=build_b, bridge_path=bridge_path)
    try:
        obs, _info = env.reset(seed=3)
        vector = obs[0]
        block_ids = [
            vector[OBS_SELF_FIELD_COUNT + slot * OBS_UNIT_FIELD_COUNT + OBS_UNIT_ID_OFFSET]
            for slot in range(3)
        ]
        assert list(block_ids) == [1, 2, 3]
        assert env._slot_to_unit_id == [1, 2, 3]
    finally:
        env.close()


# --- check_env on the single-agent WarwrightEnv -----------------------------


def test_check_env_passes_for_the_single_agent_env(bridge_path):
    env = WarwrightEnv(
        build_a=_lone_external_build(),
        build_b=_small_baseline_build(),
        bridge_path=bridge_path,
    )
    try:
        check_env(env, skip_render_check=True)
    finally:
        env.close()


# --- Terminal mapping: reward always 0.0, winner/hash in info on done ------


def test_reward_is_always_zero_and_terminal_frames_carry_winner_and_hash(bridge_path):
    build_a = _lone_external_build()
    build_b = {
        "name": "Weak B",
        "units": [
            {
                "roleId": "mender",
                "skillIds": [],
                "behaviorId": "aggro-lowest-hp",
                "position": {"x": 10, "y": 0},
            }
        ],
    }
    env = WarwrightVectorEnv(1, build_a=build_a, build_b=build_b, bridge_path=bridge_path)
    try:
        env.reset(seed=5)
        attack = np.array([3, 0, 0, 0, 0], dtype=np.int64)  # attack target_slot 0

        saw_done = False
        for _ in range(MAX_ROUNDS):
            obs, rewards, terminated, truncated, info = env.step(np.array([attack]))
            assert rewards.tolist() == [0.0]
            assert truncated.tolist() == [False]
            if terminated[0]:
                saw_done = True
                assert info["winner"][0] in ("A", "B", "draw")
                assert isinstance(info["hash"][0], int)
                break
        assert saw_done, "match must reach done within MAX_ROUNDS"
    finally:
        env.close()


# --- Dead-agent-continues ---------------------------------------------------


def test_env_keeps_stepping_after_the_agent_unit_dies(bridge_path):
    # A very weak external unit against a strong baseline so the agent dies
    # quickly; the env must keep accepting steps (no external-action-missing
    # crash) until the match reaches done.
    build_a = {
        "name": "Fragile A",
        "units": [
            {
                "roleId": "mender",
                "skillIds": [],
                "behaviorId": EXTERNAL_BEHAVIOR_ID,
                "position": {"x": 0, "y": 0},
            }
        ],
    }
    build_b = {
        "name": "Strong B",
        "units": [
            {
                "roleId": "reaver",
                "skillIds": [],
                "behaviorId": "aggro-lowest-hp",
                "position": {"x": 5, "y": 0},
            }
        ],
    }
    env = WarwrightVectorEnv(1, build_a=build_a, build_b=build_b, bridge_path=bridge_path)
    try:
        env.reset(seed=9)
        done = False
        for _ in range(MAX_ROUNDS):
            obs, rewards, terminated, truncated, info = env.step(np.array([_idle_action()]))
            if terminated[0]:
                done = True
                assert info["winner"][0] == "B"
                break
        assert done
    finally:
        env.close()


def _fragile_build_a():
    return {
        "name": "Fragile A",
        "units": [
            {
                "roleId": "mender",
                "skillIds": [],
                "behaviorId": EXTERNAL_BEHAVIOR_ID,
                "position": {"x": 0, "y": 0},
            }
        ],
    }


def _strong_build_b():
    return {
        "name": "Strong B",
        "units": [
            {
                "roleId": "reaver",
                "skillIds": [],
                "behaviorId": "aggro-lowest-hp",
                "position": {"x": 5, "y": 0},
            }
        ],
    }


# --- NEXT_STEP autoreset freshness (WarwrightVectorEnv) ---------------------


def test_next_step_autoreset_is_a_fresh_episode(bridge_path):
    # A fragile agent that loses quickly, then one extra step() call past
    # `terminated`. Under AutoresetMode.NEXT_STEP that call must autoreset
    # BEFORE stepping: terminated False, a brand-new full-hp observation,
    # winner/hash cleared to None, and a freshly-drawn replay seed.
    env = WarwrightVectorEnv(
        1, build_a=_fragile_build_a(), build_b=_strong_build_b(), bridge_path=bridge_path
    )
    try:
        env.reset(seed=9)

        prior_seed = None
        for _ in range(MAX_ROUNDS):
            obs, rewards, terminated, truncated, info = env.step(np.array([_idle_action()]))
            if terminated[0]:
                prior_seed = int(info["replay_seed"][0])
                break
        assert prior_seed is not None, "match must reach done within MAX_ROUNDS"

        obs, rewards, terminated, truncated, info = env.step(np.array([_idle_action()]))

        assert terminated[0] == False  # noqa: E712 -- np.bool_, not `is False`
        assert obs[0][OBS_SELF_HP_INDEX] == obs[0][OBS_SELF_MAX_HP_INDEX]
        assert info["winner"][0] is None
        assert int(info["replay_seed"][0]) != prior_seed
    finally:
        env.close()


# --- step() after terminated without reset() (WarwrightEnv) -----------------


def test_single_agent_step_after_terminated_without_reset_raises(bridge_path):
    # WarwrightEnv wraps a WarwrightVectorEnv(1, ...) with NEXT_STEP
    # autoreset; left unguarded, a step() call after `terminated` would
    # silently autoreset (discarding the caller's action) instead of
    # honoring the single-agent Gymnasium convention of requiring reset().
    env = WarwrightEnv(
        build_a=_fragile_build_a(), build_b=_strong_build_b(), bridge_path=bridge_path
    )
    try:
        env.reset(seed=9)
        idle = _idle_action()

        saw_terminated = False
        for _ in range(MAX_ROUNDS):
            obs, reward, terminated, truncated, info = env.step(idle)
            if terminated or truncated:
                saw_terminated = True
                break
        assert saw_terminated, "match must reach done within MAX_ROUNDS"

        with pytest.raises(RuntimeError, match="reset"):
            env.step(idle)
    finally:
        env.close()
