"""Unit tests for warwright_gym.training.policy (#65): shapes, seeded
reproducibility, and deterministic-vs-stochastic `act()` behavior for the
actor-critic MLP. No torch training loop here -- see test_ppo.py for that.
"""

from __future__ import annotations

import numpy as np
import torch

from warwright_gym.training.policy import ActorCriticPolicy

OBS_DIM = 23
NVEC = [5, 3, 6, 1001, 1001]


def _policy(seed: int = 0) -> ActorCriticPolicy:
    torch.manual_seed(seed)
    return ActorCriticPolicy(obs_dim=OBS_DIM, nvec=NVEC)


def test_act_returns_one_action_component_per_nvec_entry():
    policy = _policy()
    obs = torch.zeros((4, OBS_DIM), dtype=torch.float32)

    actions, log_prob, entropy, value = policy.act(obs)

    assert actions.shape == (4, len(NVEC))
    assert log_prob.shape == (4,)
    assert entropy.shape == (4,)
    assert value.shape == (4,)


def test_act_actions_are_within_each_component_bound():
    policy = _policy()
    obs = torch.randn((32, OBS_DIM), dtype=torch.float32)

    actions, _, _, _ = policy.act(obs)

    actions_np = actions.numpy()
    for component, bound in enumerate(NVEC):
        assert actions_np[:, component].min() >= 0
        assert actions_np[:, component].max() < bound


def test_act_deterministic_is_reproducible_across_calls():
    policy = _policy()
    obs = torch.randn((8, OBS_DIM), dtype=torch.float32)

    first, _, _, first_value = policy.act(obs, deterministic=True)
    second, _, _, second_value = policy.act(obs, deterministic=True)

    assert torch.equal(first, second)
    assert torch.equal(first_value, second_value)


def test_act_deterministic_matches_per_component_argmax():
    policy = _policy()
    obs = torch.randn((5, OBS_DIM), dtype=torch.float32)

    actions, _, _, _ = policy.act(obs, deterministic=True)
    logits = policy.actor_logits(obs)

    expected = torch.stack([component.argmax(dim=-1) for component in logits], dim=-1)
    assert torch.equal(actions, expected)


def test_same_torch_seed_produces_identical_initial_weights():
    first = _policy(seed=42)
    second = _policy(seed=42)

    for (name, first_param), (_, second_param) in zip(
        first.named_parameters(), second.named_parameters(), strict=True
    ):
        assert torch.equal(first_param, second_param), f"{name} differs across seeded inits"


def test_evaluate_actions_matches_act_log_prob_and_entropy():
    policy = _policy()
    obs = torch.randn((6, OBS_DIM), dtype=torch.float32)

    actions, log_prob, entropy, value = policy.act(obs)
    replay_log_prob, replay_entropy, replay_value = policy.evaluate_actions(obs, actions)

    assert torch.allclose(log_prob, replay_log_prob, atol=1e-6)
    assert torch.allclose(entropy, replay_entropy, atol=1e-6)
    assert torch.allclose(value, replay_value, atol=1e-6)


def test_act_accepts_numpy_observations():
    policy = _policy()
    obs = np.random.default_rng(0).standard_normal((3, OBS_DIM)).astype(np.float32)

    actions, log_prob, entropy, value = policy.act(obs)

    assert actions.shape == (3, len(NVEC))
    assert isinstance(actions, torch.Tensor)
