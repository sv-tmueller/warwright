"""Tests for #131's `--save-checkpoint` addition to `smoke_run.py`: the
missing persistence step #65 deliberately left out (`smoke_run.py` only
printed a JSON report). The fast test below covers arg parsing only (no
bridge); the bridge-backed test proves `run_smoke` actually writes a
loadable `torch.save`d `state_dict` for the trained policy.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

pytest.importorskip("torch")

import torch

from warwright_gym.observation import compute_observation_length
from warwright_gym.training.policy import ActorCriticPolicy
from warwright_gym.training.ppo import PPOConfig
from warwright_gym.training.smoke_run import _parse_args, run_smoke, smoke_build_a, smoke_build_b


def test_parse_args_accepts_save_checkpoint(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["prog", "--save-checkpoint", "/tmp/policy.pt"])
    args = _parse_args()
    assert args.save_checkpoint == Path("/tmp/policy.pt")


def test_parse_args_save_checkpoint_defaults_to_none(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["prog"])
    args = _parse_args()
    assert args.save_checkpoint is None


def _tiny_config(seed: int = 1) -> PPOConfig:
    return PPOConfig(
        num_envs=2,
        ticks_per_step=20,
        num_steps=8,
        total_timesteps=32,
        update_epochs=1,
        num_minibatches=1,
        seed=seed,
    )


def test_run_smoke_writes_a_loadable_checkpoint_matching_the_trained_policy_shape(
    tmp_path, bridge_path
):
    checkpoint_path = tmp_path / "policy.pt"
    config = _tiny_config()

    run_smoke(config, node="node", bridge_path=bridge_path, save_checkpoint_path=checkpoint_path)

    assert checkpoint_path.exists()
    state_dict = torch.load(checkpoint_path, map_location="cpu", weights_only=True)

    num_allies = len(smoke_build_a()["units"]) - 1
    num_enemies = len(smoke_build_b()["units"])
    obs_dim = compute_observation_length(num_allies, num_enemies)
    nvec = [5, num_allies + num_enemies, 6, 1001, 1001]

    reconstructed = ActorCriticPolicy(obs_dim=obs_dim, nvec=nvec)
    reconstructed.load_state_dict(state_dict)  # raises on any key/shape mismatch
