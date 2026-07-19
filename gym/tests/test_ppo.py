"""Unit tests for warwright_gym.training.ppo (#65): seeding, GAE, the
NEXT_STEP autoreset masking (the novel part -- a per-env validity mask that
excludes boundary/fabricated transitions from the PPO update while
guaranteeing GAE never bootstraps a real episode's advantage across such a
boundary), and the loss-masking that consumes it. No real bridge/env here
-- see test_ppo_smoke.py for the tiny bridge-backed end-to-end smoke and
reproducibility tests.
"""

from __future__ import annotations

import pytest

pytest.importorskip("torch")

import torch

from warwright_gym.training.policy import ActorCriticPolicy
from warwright_gym.training.ppo import PPOConfig, compute_gae, mask_invalid_steps, seed_everything


def test_seed_everything_asserts_cuda_is_not_available(monkeypatch):
    # CPU-only determinism (see `seed_everything`'s docstring and
    # gym/TRAINING_RESULTS.md) must be self-enforcing in code, not merely a
    # byproduct of the pinned CPU-wheel torch index -- so a device that
    # reports CUDA availability must fail loud rather than silently train
    # non-deterministically.
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)

    with pytest.raises(AssertionError, match="CPU"):
        seed_everything(0)


def test_seed_everything_makes_two_policy_inits_identical():
    seed_everything(123)
    first = ActorCriticPolicy(obs_dim=10, nvec=[3, 4])

    seed_everything(123)
    second = ActorCriticPolicy(obs_dim=10, nvec=[3, 4])

    for (name, first_param), (_, second_param) in zip(
        first.named_parameters(), second.named_parameters(), strict=True
    ):
        assert torch.equal(first_param, second_param), f"{name} differs after reseeding"


def test_seed_everything_makes_two_sampled_action_streams_identical():
    seed_everything(7)
    policy = ActorCriticPolicy(obs_dim=6, nvec=[3, 3])
    obs = torch.randn((4, 6))
    seed_everything(99)
    first_actions, *_ = policy.act(obs)

    seed_everything(99)
    second_actions, *_ = policy.act(obs)

    assert torch.equal(first_actions, second_actions)


def _config(**overrides) -> PPOConfig:
    base = dict(num_envs=1, num_steps=4, gamma=0.9, gae_lambda=0.8)
    base.update(overrides)
    return PPOConfig(**base)


def test_compute_gae_matches_hand_computed_values_for_a_short_episode():
    # One env, 3 real steps, no termination within the window; bootstrap
    # value at the end is nonzero. Hand-computed against the standard GAE
    # recursion (gamma=0.9, lambda=0.8).
    rewards = torch.tensor([[1.0], [0.5], [0.0]])
    values = torch.tensor([[1.0], [1.0], [1.0]])
    terminated = torch.zeros((3, 1), dtype=torch.bool)
    last_value = torch.tensor([2.0])

    advantages, returns = compute_gae(
        rewards=rewards,
        values=values,
        terminated=terminated,
        last_value=last_value,
        gamma=0.9,
        gae_lambda=0.8,
    )

    gamma, lam = 0.9, 0.8
    delta_2 = 0.0 + gamma * 2.0 * 1.0 - 1.0
    adv_2 = delta_2
    delta_1 = 0.5 + gamma * 1.0 * 1.0 - 1.0
    adv_1 = delta_1 + gamma * lam * 1.0 * adv_2
    delta_0 = 1.0 + gamma * 1.0 * 1.0 - 1.0
    adv_0 = delta_0 + gamma * lam * 1.0 * adv_1

    expected_advantages = torch.tensor([[adv_0], [adv_1], [adv_2]])
    assert torch.allclose(advantages, expected_advantages, atol=1e-6)
    assert torch.allclose(returns, advantages + values, atol=1e-6)


def test_compute_gae_terminal_step_does_not_bootstrap_past_termination():
    # Step 1 terminates; step 2 is a fabricated NEXT_STEP autoreset
    # boundary transition (reward/value are garbage on purpose). Step 0's
    # advantage must be identical whether or not step 2's data is garbage,
    # because terminated[1] gates the bootstrap to 0 there.
    rewards_a = torch.tensor([[1.0], [1.0], [0.0]])
    rewards_b = torch.tensor([[1.0], [1.0], [999.0]])  # garbage boundary reward
    values = torch.tensor([[1.0], [1.0], [-500.0]])  # garbage boundary value
    terminated = torch.tensor([[False], [True], [False]])
    last_value = torch.tensor([3.0])

    advantages_a, _ = compute_gae(
        rewards=rewards_a, values=values, terminated=terminated,
        last_value=last_value, gamma=0.9, gae_lambda=0.8,
    )
    advantages_b, _ = compute_gae(
        rewards=rewards_b, values=values, terminated=terminated,
        last_value=last_value, gamma=0.9, gae_lambda=0.8,
    )

    # Steps 0 and 1 are unaffected by the boundary step's garbage reward.
    assert torch.allclose(advantages_a[:2], advantages_b[:2], atol=1e-6)


def test_mask_invalid_steps_flags_the_step_immediately_after_termination():
    # env 0: steps [0,1,2,3] terminate at step 1 -> step 2 is the
    # discarded-action autoreset boundary (invalid), step 3 is a real step
    # of the new episode (valid).
    # env 1: never terminates -> every step valid.
    terminated = torch.tensor(
        [
            [False, False],
            [True, False],
            [False, False],
            [False, False],
        ]
    )
    pending_reset_before_rollout = torch.zeros(2, dtype=torch.bool)

    valid, pending_reset_after = mask_invalid_steps(terminated, pending_reset_before_rollout)

    expected_valid = torch.tensor(
        [
            [True, True],
            [True, True],
            [False, True],
            [True, True],
        ]
    )
    assert torch.equal(valid, expected_valid)
    assert torch.equal(pending_reset_after, torch.tensor([False, False]))


def test_mask_invalid_steps_honors_pending_reset_carried_in_from_a_prior_rollout():
    # env 0 terminated on the LAST step of the previous rollout -> this
    # rollout's first step is the discarded-action boundary.
    terminated = torch.tensor([[False], [False]])
    pending_reset_before_rollout = torch.tensor([True])

    valid, pending_reset_after = mask_invalid_steps(terminated, pending_reset_before_rollout)

    assert torch.equal(valid, torch.tensor([[False], [True]]))
    assert torch.equal(pending_reset_after, torch.tensor([False]))
