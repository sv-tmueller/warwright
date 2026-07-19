"""Unit tests for warwright_gym.rewards (#127) over a pure-Python STUB
vector env -- no bridge, no Transport, no subprocess. The stub returns
canned obs/info per reset()/step() call so every reward-shaping code path
(terminal sign, damage-dealt net-of-healing, ally-hp, per-term toggles, the
autoreset-boundary re-baseline) is exercised deterministically.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError, asdict

import numpy as np
import pytest
from gymnasium.spaces import Box, Discrete
from gymnasium.vector import AutoresetMode, VectorEnv
from gymnasium.vector.utils import batch_space

from warwright_gym.observation import (
    OBS_SELF_FIELD_COUNT,
    OBS_SELF_HP_INDEX,
    OBS_SELF_MAX_HP_INDEX,
    OBS_UNIT_FIELD_COUNT,
    OBS_UNIT_HP_OFFSET,
    OBS_UNIT_ID_OFFSET,
    OBS_UNIT_MAX_HP_OFFSET,
)
from warwright_gym.rewards import RewardConfig, RewardShapingWrapper

# One ally block, then one enemy block -- exercises both halves of the
# allies-then-enemies block order without collapsing self+ally into a
# single term.
NUM_ALLIES = 1
OBS_LENGTH = OBS_SELF_FIELD_COUNT + OBS_UNIT_FIELD_COUNT * 2


def _self_block(hp: int, max_hp: int = 100) -> list[int]:
    block = [0] * OBS_SELF_FIELD_COUNT
    block[OBS_SELF_HP_INDEX] = hp
    block[OBS_SELF_MAX_HP_INDEX] = max_hp
    return block


def _unit_block(unit_id: int, hp: int, max_hp: int = 100) -> list[int]:
    block = [0] * OBS_UNIT_FIELD_COUNT
    block[OBS_UNIT_ID_OFFSET] = unit_id
    block[OBS_UNIT_HP_OFFSET] = hp
    block[OBS_UNIT_MAX_HP_OFFSET] = max_hp
    return block


def _row(self_hp, ally_hp, enemy_hp, self_max=100, ally_max=100, enemy_max=100) -> list[int]:
    return (
        _self_block(self_hp, self_max)
        + _unit_block(1, ally_hp, ally_max)
        + _unit_block(2, enemy_hp, enemy_max)
    )


def _frame(rows: list[list[int]]) -> np.ndarray:
    return np.array(rows, dtype=np.int64)


class StubVectorEnv(VectorEnv):
    """Returns canned frames from `reset_frames`/`step_frames`, one per
    call, in order. Reward is always 0.0 from this stub (matching
    WarwrightVectorEnv's own #64 contract) -- RewardShapingWrapper computes
    the real reward from obs/info alone."""

    metadata = {"autoreset_mode": AutoresetMode.NEXT_STEP}

    def __init__(self, num_envs: int, reset_frames, step_frames) -> None:
        super().__init__()
        self.num_envs = num_envs
        self._reset_frames = list(reset_frames)
        self._step_frames = list(step_frames)
        self._reset_calls = 0
        self._step_calls = 0
        self.single_observation_space = Box(
            low=-1, high=np.iinfo(np.int64).max, shape=(OBS_LENGTH,), dtype=np.int64
        )
        self.single_action_space = Discrete(1)
        self.observation_space = batch_space(self.single_observation_space, num_envs)
        self.action_space = batch_space(self.single_action_space, num_envs)

    def reset(self, *, seed=None, options=None):
        obs, info = self._reset_frames[self._reset_calls]
        self._reset_calls += 1
        return obs, info

    def step(self, actions):
        obs, terminated, truncated, info = self._step_frames[self._step_calls]
        self._step_calls += 1
        rewards = np.zeros(self.num_envs, dtype=np.float64)
        return obs, rewards, terminated, truncated, info


def _winner_info(winners):
    return {"winner": np.array(winners, dtype=object)}


# --- Terminal sign -----------------------------------------------------


@pytest.mark.parametrize(
    ("winner", "expected_field"),
    [("A", "win_reward"), ("B", "loss_reward"), ("draw", "draw_reward")],
)
def test_terminal_reward_matches_winner_sign(winner, expected_field):
    reset_obs = _frame([_row(100, 100, 100)])
    step_obs = _frame([_row(100, 100, 100)])  # no hp change -> shaping is 0.0
    stub = StubVectorEnv(
        1,
        reset_frames=[(reset_obs, {})],
        step_frames=[
            (step_obs, np.array([True]), np.array([False]), _winner_info([winner])),
        ],
    )
    config = RewardConfig()
    wrapper = RewardShapingWrapper(stub, config, num_allies=NUM_ALLIES)

    wrapper.reset()
    _obs, rewards, _terminated, _truncated, _info = wrapper.step(np.array([0]))

    assert rewards[0] == pytest.approx(getattr(config, expected_field))


# --- Damage-dealt shaping ------------------------------------------------


def test_damage_dealt_equals_enemy_hp_lost_normalized_by_enemy_max_hp():
    reset_obs = _frame([_row(100, 100, 100)])
    step_obs = _frame([_row(100, 100, 60)])  # enemy lost 40 hp
    stub = StubVectorEnv(
        1,
        reset_frames=[(reset_obs, {})],
        step_frames=[
            (step_obs, np.array([False]), np.array([False]), _winner_info([None])),
        ],
    )
    config = RewardConfig(ally_hp_weight=0.0)
    wrapper = RewardShapingWrapper(stub, config, num_allies=NUM_ALLIES)

    wrapper.reset()
    _obs, rewards, _terminated, _truncated, _info = wrapper.step(np.array([0]))

    assert rewards[0] == pytest.approx(config.damage_dealt_weight * 40 / 100)


def test_damage_dealt_is_net_of_enemy_healing():
    reset_obs = _frame([_row(100, 100, 60)])
    step_obs = _frame([_row(100, 100, 80)])  # enemy healed 20 hp -> negative "damage"
    stub = StubVectorEnv(
        1,
        reset_frames=[(reset_obs, {})],
        step_frames=[
            (step_obs, np.array([False]), np.array([False]), _winner_info([None])),
        ],
    )
    config = RewardConfig(ally_hp_weight=0.0)
    wrapper = RewardShapingWrapper(stub, config, num_allies=NUM_ALLIES)

    wrapper.reset()
    _obs, rewards, _terminated, _truncated, _info = wrapper.step(np.array([0]))

    assert rewards[0] == pytest.approx(config.damage_dealt_weight * (-20) / 100)


def test_overkill_hp_is_clamped_at_zero_before_differencing():
    reset_obs = _frame([_row(100, 100, 30)])
    # A stale/negative hp reading (defensive case): clamp to 0 first, so the
    # "damage" recorded is 30 (30 -> 0), never 80 (30 -> -50).
    step_obs = _frame([_row(100, 100, -50)])
    stub = StubVectorEnv(
        1,
        reset_frames=[(reset_obs, {})],
        step_frames=[
            (step_obs, np.array([False]), np.array([False]), _winner_info([None])),
        ],
    )
    config = RewardConfig(ally_hp_weight=0.0)
    wrapper = RewardShapingWrapper(stub, config, num_allies=NUM_ALLIES)

    wrapper.reset()
    _obs, rewards, _terminated, _truncated, _info = wrapper.step(np.array([0]))

    assert rewards[0] == pytest.approx(config.damage_dealt_weight * 30 / 100)


# --- Ally-hp shaping -------------------------------------------------------


def test_ally_hp_term_covers_self_plus_allies_normalized_by_team_max_hp():
    reset_obs = _frame([_row(100, 100, 100)])
    step_obs = _frame([_row(80, 90, 100)])  # self -20, ally -10 -> team -30 / 200
    stub = StubVectorEnv(
        1,
        reset_frames=[(reset_obs, {})],
        step_frames=[
            (step_obs, np.array([False]), np.array([False]), _winner_info([None])),
        ],
    )
    config = RewardConfig(damage_dealt_weight=0.0)
    wrapper = RewardShapingWrapper(stub, config, num_allies=NUM_ALLIES)

    wrapper.reset()
    _obs, rewards, _terminated, _truncated, _info = wrapper.step(np.array([0]))

    assert rewards[0] == pytest.approx(config.ally_hp_weight * (-30) / 200)


# --- Per-term toggles -------------------------------------------------------


def test_disabling_damage_dealt_zeroes_that_term():
    reset_obs = _frame([_row(100, 100, 100)])
    step_obs = _frame([_row(100, 100, 50)])
    stub = StubVectorEnv(
        1,
        reset_frames=[(reset_obs, {})],
        step_frames=[
            (step_obs, np.array([False]), np.array([False]), _winner_info([None])),
        ],
    )
    config = RewardConfig(enable_damage_dealt=False, ally_hp_weight=0.0)
    wrapper = RewardShapingWrapper(stub, config, num_allies=NUM_ALLIES)

    wrapper.reset()
    _obs, rewards, _terminated, _truncated, _info = wrapper.step(np.array([0]))

    assert rewards[0] == 0.0


def test_disabling_ally_hp_zeroes_that_term():
    reset_obs = _frame([_row(100, 100, 100)])
    step_obs = _frame([_row(50, 100, 100)])
    stub = StubVectorEnv(
        1,
        reset_frames=[(reset_obs, {})],
        step_frames=[
            (step_obs, np.array([False]), np.array([False]), _winner_info([None])),
        ],
    )
    config = RewardConfig(enable_ally_hp=False, damage_dealt_weight=0.0)
    wrapper = RewardShapingWrapper(stub, config, num_allies=NUM_ALLIES)

    wrapper.reset()
    _obs, rewards, _terminated, _truncated, _info = wrapper.step(np.array([0]))

    assert rewards[0] == 0.0


def test_disabling_terminal_zeroes_the_win_reward():
    reset_obs = _frame([_row(100, 100, 100)])
    step_obs = _frame([_row(100, 100, 100)])
    stub = StubVectorEnv(
        1,
        reset_frames=[(reset_obs, {})],
        step_frames=[
            (step_obs, np.array([True]), np.array([False]), _winner_info(["A"])),
        ],
    )
    config = RewardConfig(enable_terminal=False)
    wrapper = RewardShapingWrapper(stub, config, num_allies=NUM_ALLIES)

    wrapper.reset()
    _obs, rewards, _terminated, _truncated, _info = wrapper.step(np.array([0]))

    assert rewards[0] == 0.0


def test_custom_weights_scale_the_shaping_terms():
    reset_obs = _frame([_row(100, 100, 100)])
    step_obs = _frame([_row(100, 100, 60)])  # enemy -40
    stub = StubVectorEnv(
        1,
        reset_frames=[(reset_obs, {})],
        step_frames=[
            (step_obs, np.array([False]), np.array([False]), _winner_info([None])),
        ],
    )
    config = RewardConfig(damage_dealt_weight=2.0, ally_hp_weight=0.0)
    wrapper = RewardShapingWrapper(stub, config, num_allies=NUM_ALLIES)

    wrapper.reset()
    _obs, rewards, _terminated, _truncated, _info = wrapper.step(np.array([0]))

    assert rewards[0] == pytest.approx(2.0 * 40 / 100)


# --- Autoreset boundary -----------------------------------------------------


def test_autoreset_boundary_frame_yields_zero_shaping_and_rebaselines():
    reset_obs = _frame([_row(100, 100, 100)])
    # Step 1: agent wins, enemy hp hits 0.
    terminal_obs = _frame([_row(100, 100, 0)])
    # Step 2: WarwrightVectorEnv's own NEXT_STEP autoreset already fired
    # inside the wrapped env -- this frame is a brand-new full-hp episode,
    # NOT a real transition from the terminal frame above. Diffing it
    # against terminal_obs naively would read as ~100 hp of "enemy healing"
    # and "ally hp gain" -- must be suppressed to 0.0 instead.
    fresh_obs = _frame([_row(100, 100, 100)])
    # Step 3: a real transition from the fresh baseline -- enemy takes 10.
    next_obs = _frame([_row(100, 100, 90)])

    stub = StubVectorEnv(
        1,
        reset_frames=[(reset_obs, {})],
        step_frames=[
            (terminal_obs, np.array([True]), np.array([False]), _winner_info(["A"])),
            (fresh_obs, np.array([False]), np.array([False]), _winner_info([None])),
            (next_obs, np.array([False]), np.array([False]), _winner_info([None])),
        ],
    )
    config = RewardConfig(ally_hp_weight=0.0)
    wrapper = RewardShapingWrapper(stub, config, num_allies=NUM_ALLIES)

    wrapper.reset()
    _obs, first_rewards, terminated, _truncated, _info = wrapper.step(np.array([0]))
    assert terminated[0]
    assert first_rewards[0] == pytest.approx(config.damage_dealt_weight * 100 / 100 + 1.0)

    _obs, boundary_rewards, boundary_terminated, _truncated, _info = wrapper.step(np.array([0]))
    assert not boundary_terminated[0]
    assert boundary_rewards[0] == 0.0

    _obs, third_rewards, _terminated, _truncated, _info = wrapper.step(np.array([0]))
    assert third_rewards[0] == pytest.approx(config.damage_dealt_weight * 10 / 100)


# --- reset() re-baselines and caches maxHp once -----------------------------


def test_reset_rebaselines_prev_obs_and_caches_max_hp_only_from_the_first_reset():
    first_reset_obs = _frame([_row(100, 100, 100, enemy_max=100)])
    # A second reset() call with a DIFFERENT enemy maxHp -- contrived (a
    # real WarwrightVectorEnv build pair is fixed for its lifetime), but it
    # proves the normalizer is cached from the FIRST reset frame only, not
    # recomputed on every reset().
    second_reset_obs = _frame([_row(100, 100, 100, enemy_max=200)])
    step_obs = _frame([_row(100, 100, 50, enemy_max=200)])

    stub = StubVectorEnv(
        1,
        reset_frames=[(first_reset_obs, {}), (second_reset_obs, {})],
        step_frames=[
            (step_obs, np.array([False]), np.array([False]), _winner_info([None])),
        ],
    )
    config = RewardConfig(ally_hp_weight=0.0)
    wrapper = RewardShapingWrapper(stub, config, num_allies=NUM_ALLIES)

    wrapper.reset()
    wrapper.reset()
    _obs, rewards, _terminated, _truncated, _info = wrapper.step(np.array([0]))

    # Normalized by the FIRST reset's enemy maxHp (100), not the second
    # reset's (200): 50 / 100, not 50 / 200.
    assert rewards[0] == pytest.approx(config.damage_dealt_weight * 50 / 100)


# --- RewardConfig -----------------------------------------------------------


def test_reward_config_asdict_round_trips():
    config = RewardConfig(win_reward=2.0, damage_dealt_weight=0.25, enable_ally_hp=False)
    data = asdict(config)
    assert data == {
        "win_reward": 2.0,
        "loss_reward": -1.0,
        "draw_reward": 0.0,
        "damage_dealt_weight": 0.25,
        "ally_hp_weight": 0.1,
        "enable_terminal": True,
        "enable_damage_dealt": True,
        "enable_ally_hp": False,
    }
    assert RewardConfig(**data) == config


def test_reward_config_defaults():
    config = RewardConfig()
    assert config.win_reward == 1.0
    assert config.loss_reward == -1.0
    assert config.draw_reward == 0.0
    assert config.damage_dealt_weight == 0.5
    assert config.ally_hp_weight == 0.1


def test_reward_config_is_frozen():
    config = RewardConfig()
    with pytest.raises(FrozenInstanceError):
        config.win_reward = 5.0
