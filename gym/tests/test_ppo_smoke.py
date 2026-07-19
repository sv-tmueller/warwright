"""Bridge-backed integration tests for #65's PPO loop: a REAL
`WarwrightVectorEnv` (built gym-bridge subprocess, real core), wrapped
with `RewardShapingWrapper`. Two things only pure/stub tests can't prove:

  1. A TINY end-to-end smoke: the loop runs against the real env, losses
     are finite, and rewards are nonzero (NO improvement assertion --
     that's `smoke_run.py`'s job, run manually and recorded in
     TRAINING_RESULTS.md).
  2. Reproducibility: two `train()` runs at a tiny budget, same seed, same
     box -> bitwise-identical `state_dict` and identical summed reward;
     two `evaluate()` runs of the same (deterministic) policy -> identical
     per-match winners.
"""

from __future__ import annotations

import math

import pytest

pytest.importorskip("torch")

import torch

from warwright_gym.env import WarwrightVectorEnv, default_build_a, default_build_b
from warwright_gym.rewards import RewardConfig, RewardShapingWrapper
from warwright_gym.training.evaluate import TorchPolicyAdapter, evaluate
from warwright_gym.training.policy import ActorCriticPolicy
from warwright_gym.training.ppo import PPOConfig, train

TICKS_PER_STEP = 20
_NUM_ALLIES = len(default_build_a()["units"]) - 1
_NUM_ENEMIES = len(default_build_b()["units"])
_NVEC = [5, _NUM_ALLIES + _NUM_ENEMIES, 6, 1001, 1001]


def _tiny_env(bridge_path):
    env = WarwrightVectorEnv(2, ticks_per_step=TICKS_PER_STEP, bridge_path=bridge_path)
    return RewardShapingWrapper(env, RewardConfig(), num_allies=_NUM_ALLIES)


def _tiny_config(seed: int) -> PPOConfig:
    return PPOConfig(
        num_envs=2,
        ticks_per_step=TICKS_PER_STEP,
        num_steps=8,
        # Two rollouts/updates (steps_per_rollout = num_steps * num_envs =
        # 8 * 2 = 16), not one: a single update never exercises cross-update
        # carry-over (Adam optimizer state, `obs`/`pending_reset` threading
        # between `train()`'s update loop iterations), which the
        # reproducibility test below is meant to guard.
        total_timesteps=32,
        update_epochs=1,
        num_minibatches=1,
        seed=seed,
    )


def _obs_dim() -> int:
    from warwright_gym.observation import compute_observation_length

    return compute_observation_length(_NUM_ALLIES, _NUM_ENEMIES)


def test_tiny_ppo_loop_runs_with_finite_losses_and_nonzero_rewards(bridge_path):
    env = _tiny_env(bridge_path)
    try:
        config = _tiny_config(seed=1)
        torch.manual_seed(config.seed)
        policy = ActorCriticPolicy(obs_dim=_obs_dim(), nvec=_NVEC)

        _trained_policy, losses = train(env, config, policy)

        assert math.isfinite(losses["policy_loss"])
        assert math.isfinite(losses["value_loss"])
        assert math.isfinite(losses["entropy"])
        assert losses["num_valid_samples"] > 0
        assert losses["total_reward_sum"] != 0.0
    finally:
        env.close()


def test_train_is_reproducible_same_seed_same_box(bridge_path):
    seed = 42

    env_a = _tiny_env(bridge_path)
    try:
        config = _tiny_config(seed=seed)
        torch.manual_seed(seed)
        policy_a = ActorCriticPolicy(obs_dim=_obs_dim(), nvec=_NVEC)
        trained_a, losses_a = train(env_a, config, policy_a)
    finally:
        env_a.close()

    env_b = _tiny_env(bridge_path)
    try:
        config = _tiny_config(seed=seed)
        torch.manual_seed(seed)
        policy_b = ActorCriticPolicy(obs_dim=_obs_dim(), nvec=_NVEC)
        trained_b, losses_b = train(env_b, config, policy_b)
    finally:
        env_b.close()

    for (name, param_a), (_, param_b) in zip(
        trained_a.named_parameters(), trained_b.named_parameters(), strict=True
    ):
        assert torch.equal(param_a, param_b), f"{name} differs across two same-seed runs"

    assert losses_a["total_reward_sum"] == losses_b["total_reward_sum"]


def test_evaluate_is_reproducible_across_two_runs(bridge_path):
    torch.manual_seed(7)
    policy = ActorCriticPolicy(obs_dim=_obs_dim(), nvec=_NVEC)
    adapter = TorchPolicyAdapter(policy)

    env_a = WarwrightVectorEnv(2, ticks_per_step=TICKS_PER_STEP, bridge_path=bridge_path)
    try:
        result_a = evaluate(env_a, adapter, num_batches=1, seed_base=555)
    finally:
        env_a.close()

    env_b = WarwrightVectorEnv(2, ticks_per_step=TICKS_PER_STEP, bridge_path=bridge_path)
    try:
        result_b = evaluate(env_b, adapter, num_batches=1, seed_base=555)
    finally:
        env_b.close()

    assert result_a.winners == result_b.winners
