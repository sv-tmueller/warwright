"""Unit tests for warwright_gym.training.evaluate (#65): the scripted
HEURISTIC policy's action choice (pure arithmetic over a hand-built raw
observation, no bridge) and the pinned-seed evaluation protocol (a stub
vector env, no bridge -- the seed/first-episode-winner bookkeeping is
pure Python). See test_evaluate_bridge.py for the real-bridge winnability
check.
"""

from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("torch")

import torch

from warwright_gym.actions import ACTION_KIND_ATTACK, ACTION_KIND_MOVE_TOWARD
from warwright_gym.observation import (
    OBS_SELF_FIELD_COUNT,
    OBS_UNIT_DISTANCE_SQUARED_OFFSET,
    OBS_UNIT_FIELD_COUNT,
    OBS_UNIT_HP_OFFSET,
    compute_observation_length,
)
from warwright_gym.training.evaluate import (
    EVAL_SEED_BASE,
    EvalResult,
    HeuristicPolicy,
    TorchPolicyAdapter,
    evaluate,
)
from warwright_gym.training.policy import ActorCriticPolicy

NUM_ALLIES = 0
NUM_ENEMIES = 2
LENGTH = compute_observation_length(NUM_ALLIES, NUM_ENEMIES)


def _row(enemy_hps: list[int], enemy_distances_squared: list[int]) -> np.ndarray:
    row = np.zeros(LENGTH, dtype=np.int64)
    for slot, (hp, dist_sq) in enumerate(zip(enemy_hps, enemy_distances_squared, strict=True)):
        base = OBS_SELF_FIELD_COUNT + slot * OBS_UNIT_FIELD_COUNT
        row[base + OBS_UNIT_HP_OFFSET] = hp
        row[base + OBS_UNIT_DISTANCE_SQUARED_OFFSET] = dist_sq
    return row


class _StubVectorEnv:
    """A minimal `RolloutVectorEnv`-shaped stub (no bridge, no torch): each
    `reset(seed=...)` starts a scripted, per-`step()`-call trajectory so
    the pinned-seed protocol's bookkeeping (batch seeds, first-episode-
    winner-only, ignoring any LATER autoreset episode within the same
    batch) can be tested without the real engine.

    `scripts[batch_index]` is a list of `(terminated, winners)` pairs, one
    per `step()` call in that batch, each shaped `(num_envs,)` -- `winners`
    is only read where `terminated` is `True`. A sub-env that terminates
    twice within one batch's script (simulating a NEXT_STEP autoreset
    starting and then finishing a SECOND episode before the batch's script
    ends) exercises `evaluate()`'s first-terminal-only bookkeeping.
    """

    def __init__(
        self,
        num_envs: int,
        scripts: dict[int, list[tuple[np.ndarray, np.ndarray]]],
    ) -> None:
        self.num_envs = num_envs
        self._scripts = scripts
        self.reset_seeds: list[int] = []
        self._current_batch_index = -1
        self._step_in_batch = 0

    def reset(self, *, seed=None, options=None):
        self._current_batch_index += 1
        self.reset_seeds.append(seed)
        self._step_in_batch = 0
        obs = np.zeros((self.num_envs, LENGTH), dtype=np.int64)
        return obs, {"replay_seed": np.zeros(self.num_envs, dtype=np.int64)}

    def step(self, actions):
        terminated, winners = self._scripts[self._current_batch_index][self._step_in_batch]
        self._step_in_batch += 1
        obs = np.zeros((self.num_envs, LENGTH), dtype=np.int64)
        truncated = np.zeros(self.num_envs, dtype=bool)
        rewards = np.zeros(self.num_envs, dtype=np.float64)
        info = {"winner": winners}
        return obs, rewards, terminated, truncated, info


class _ConstantActionPolicy:
    def act(self, obs: np.ndarray) -> np.ndarray:
        num_envs = obs.shape[0]
        return np.zeros((num_envs, 5), dtype=np.int64)


# --- HeuristicPolicy --------------------------------------------------


def test_heuristic_attacks_lowest_hp_alive_enemy_when_close():
    policy = HeuristicPolicy(num_allies=0, num_enemies=2)
    obs = np.stack(
        [_row(enemy_hps=[500, 100], enemy_distances_squared=[10, 20])]
    )

    actions = policy.act(obs)

    assert actions[0, 0] == ACTION_KIND_ATTACK
    assert actions[0, 1] == 1  # slot 1 has the lower hp


def test_heuristic_ignores_dead_enemies():
    policy = HeuristicPolicy(num_allies=0, num_enemies=2)
    obs = np.stack(
        [_row(enemy_hps=[0, 300], enemy_distances_squared=[10, 20])]
    )

    actions = policy.act(obs)

    assert actions[0, 1] == 1  # slot 0 is dead, must not be targeted


def test_heuristic_moves_toward_lowest_hp_enemy_when_far():
    policy = HeuristicPolicy(num_allies=0, num_enemies=2)
    obs = np.stack(
        [_row(enemy_hps=[500, 100], enemy_distances_squared=[10_000_000, 10_000_001])]
    )

    actions = policy.act(obs)

    assert actions[0, 0] == ACTION_KIND_MOVE_TOWARD
    assert actions[0, 1] == 1  # slot 1 has the lower hp


def test_heuristic_never_targets_an_ally_slot():
    # 1 ally slot (slot 0) with lower hp than the enemy (slot 1); the
    # heuristic must only ever pick an ENEMY slot.
    policy = HeuristicPolicy(num_allies=1, num_enemies=1)
    row = np.zeros(compute_observation_length(1, 1), dtype=np.int64)
    ally_base = OBS_SELF_FIELD_COUNT
    enemy_base = OBS_SELF_FIELD_COUNT + OBS_UNIT_FIELD_COUNT
    row[ally_base + OBS_UNIT_HP_OFFSET] = 10
    row[ally_base + OBS_UNIT_DISTANCE_SQUARED_OFFSET] = 5
    row[enemy_base + OBS_UNIT_HP_OFFSET] = 500
    row[enemy_base + OBS_UNIT_DISTANCE_SQUARED_OFFSET] = 5

    actions = policy.act(np.stack([row]))

    assert actions[0, 1] == 1  # the enemy slot, never the lower-hp ally slot


# --- evaluate(): pinned-seed protocol -----------------------------------


def _terminal_step(winners: list[str | None]) -> tuple[np.ndarray, np.ndarray]:
    terminated = np.array([winner is not None for winner in winners], dtype=bool)
    return terminated, np.array(winners, dtype=object)


def test_evaluate_resets_each_batch_with_seed_base_plus_batch_index():
    scripts = {i: [_terminal_step(["A", "B"])] for i in range(4)}
    env = _StubVectorEnv(num_envs=2, scripts=scripts)

    evaluate(env, _ConstantActionPolicy(), num_batches=4, seed_base=EVAL_SEED_BASE)

    assert env.reset_seeds == [EVAL_SEED_BASE + j for j in range(4)]


def test_evaluate_records_only_the_first_episode_winner_per_sub_env():
    # Sub-env 0 terminates at step 1 (first episode, winner "A"); sub-env 1
    # is still mid-episode. Step 2: sub-env 0 has (per NEXT_STEP autoreset)
    # started a brand-new episode and is not terminal; sub-env 1 finally
    # terminates ("draw"). Step 3: sub-env 0's SECOND episode also
    # terminates ("B") -- evaluate() must NOT overwrite sub-env 0's
    # already-recorded first winner ("A") with this later one.
    scripts = {
        0: [
            (np.array([True, False]), np.array(["A", None], dtype=object)),
            (np.array([False, True]), np.array([None, "draw"], dtype=object)),
            (np.array([True, False]), np.array(["B", None], dtype=object)),
        ]
    }
    env = _StubVectorEnv(num_envs=2, scripts=scripts)

    result = evaluate(env, _ConstantActionPolicy(), num_batches=1, seed_base=0)

    assert result.winners == ["A", "draw"]


def test_evaluate_computes_win_rate_over_all_recorded_winners():
    scripts = {
        0: [_terminal_step(["A", "A"])],
        1: [_terminal_step(["B", "draw"])],
    }
    env = _StubVectorEnv(num_envs=2, scripts=scripts)

    result = evaluate(env, _ConstantActionPolicy(), num_batches=2, seed_base=0)

    assert isinstance(result, EvalResult)
    assert result.num_matches == 4
    assert result.wins == 2
    assert result.losses == 1
    assert result.draws == 1
    assert result.win_rate == 0.5


# --- TorchPolicyAdapter --------------------------------------------------


def test_torch_policy_adapter_returns_wire_shaped_actions_within_bounds():
    nvec = [5, 2, 6, 1001, 1001]
    torch.manual_seed(0)
    policy = ActorCriticPolicy(obs_dim=LENGTH, nvec=nvec)
    adapter = TorchPolicyAdapter(policy)
    obs = np.random.default_rng(0).integers(0, 500, size=(3, LENGTH)).astype(np.int64)

    actions = adapter.act(obs)

    assert actions.shape == (3, 5)
    assert actions.dtype == np.int64
    for component, bound in enumerate(nvec):
        assert actions[:, component].min() >= 0
        assert actions[:, component].max() < bound


def test_torch_policy_adapter_is_deterministic_across_calls():
    torch.manual_seed(1)
    policy = ActorCriticPolicy(obs_dim=LENGTH, nvec=[5, 2, 6, 1001, 1001])
    adapter = TorchPolicyAdapter(policy)
    obs = np.random.default_rng(1).integers(0, 500, size=(3, LENGTH)).astype(np.int64)

    first = adapter.act(obs)
    second = adapter.act(obs)

    assert np.array_equal(first, second)
