# Adapted from CleanRL's ppo.py (https://github.com/vwxyzjn/cleanrl,
# MIT License, Copyright (c) 2019 CleanRL developers) -- vendored and
# rewritten (not pip-installed) per the #65 SUB_PLAN: adapted for
# MultiDiscrete action heads and for `WarwrightVectorEnv`'s
# `AutoresetMode.NEXT_STEP` semantics, which CleanRL's original loop (built
# for the old-gym/SB3-style SAME_STEP autoreset convention, where a
# terminal `step()` call already returns the next episode's first
# observation) does not handle. See `mask_invalid_steps`'s docstring for
# the NEXT_STEP-specific adaptation.
"""Vendored, adapted PPO training loop for #65. `train()` is the only
entry point most callers need; the rest of this module is exposed for
targeted unit testing (`compute_gae`, `mask_invalid_steps`, `ppo_update`).

This module never re-implements a game rule: it only drives a
`gymnasium.vector.VectorEnv`-shaped object (in practice
`RewardShapingWrapper(WarwrightVectorEnv(...))`) through its public
`reset`/`step` surface and `warwright_gym.featurize.featurize` for the
policy's float input.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np
import torch
from torch import optim

from warwright_gym.featurize import featurize
from warwright_gym.rewards import RewardConfig
from warwright_gym.training.policy import ActorCriticPolicy


def seed_everything(seed: int) -> None:
    """Seeds every RNG this training loop draws from (`random`, `numpy`,
    `torch`), forces deterministic torch kernels, and pins torch to a
    single CPU thread. Guarantees identical runs SAME BOX, same config --
    NOT cross-machine bitwise equality (different BLAS/CPU builds can
    still round differently); see gym/TRAINING_RESULTS.md."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)
    torch.set_num_threads(1)


@dataclass(frozen=True)
class PPOConfig:
    """Hyperparameters and run shape for `train()`.
    `dataclasses.asdict`-serializable so `smoke_run.py` can embed the exact
    config a policy was trained under in its report."""

    num_envs: int = 8
    ticks_per_step: int = 20
    num_steps: int = 128
    total_timesteps: int = 50_000
    learning_rate: float = 3e-4
    gamma: float = 0.99
    gae_lambda: float = 0.95
    clip_coef: float = 0.2
    ent_coef: float = 0.01
    vf_coef: float = 0.5
    max_grad_norm: float = 0.5
    update_epochs: int = 4
    num_minibatches: int = 4
    seed: int = 0
    reward_config: RewardConfig = field(default_factory=RewardConfig)


class RolloutVectorEnv(Protocol):
    """The subset of `gymnasium.vector.VectorEnv` this module drives --
    matches `RewardShapingWrapper(WarwrightVectorEnv(...))` exactly, kept
    as a `Protocol` so tests can pass a lightweight stub instead of a real
    bridge subprocess."""

    num_envs: int

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]: ...

    def step(
        self, actions: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]: ...


@dataclass
class RolloutBuffer:
    """`(num_steps, num_envs, ...)` tensors collected by `collect_rollout`.
    `valid[t, e]` is `False` exactly on a NEXT_STEP autoreset boundary step
    for sub-env `e` (see `mask_invalid_steps`) -- excluded from `ppo_update`
    but NOT specially handled by `compute_gae` (see that function's
    docstring for why plain `terminated`-gated GAE is already safe)."""

    obs: torch.Tensor
    actions: torch.Tensor
    log_probs: torch.Tensor
    values: torch.Tensor
    rewards: torch.Tensor
    terminated: torch.Tensor
    valid: torch.Tensor


def mask_invalid_steps(
    terminated: torch.Tensor, pending_reset_before_rollout: torch.Tensor
) -> tuple[torch.Tensor, torch.Tensor]:
    """The NEXT_STEP autoreset masking this module exists to get right.

    `WarwrightVectorEnv` (`AutoresetMode.NEXT_STEP`) resets a sub-env `e` on
    the call AFTER it reaches `done`, discarding whatever action was passed
    for `e` on that call and returning a fresh episode's first observation
    instead (see `WarwrightVectorEnv.step`). A training loop that stores
    that call as an ordinary transition would train on a fabricated
    (obs, action, reward, next_obs) tuple: the action was never applied,
    and `next_obs` bears no dynamical relationship to `obs`.

    Given `terminated[t, e]` (whether sub-env `e`'s action at buffer index
    `t` ended its episode -- the same per-index convention `rewards`/
    `actions`/`values` use, i.e. `terminated[t]` is part of the OUTPUT of
    the step taken at `t`) and the pending-reset flags carried in from
    before this rollout began, returns:
      - `valid[t, e]`: `False` iff sub-env `e` was already pending a reset
        entering buffer index `t` (i.e. `t` is the discarded-action
        boundary step for `e`) -- `True` otherwise.
      - `pending_reset_after`: the pending-reset flags to carry into the
        NEXT rollout (`terminated` on the last buffered step, since a
        sub-env that just terminated on the final step of this rollout
        will autoreset on the first step of the next one).
    """
    num_steps = terminated.shape[0]
    pending_reset = torch.zeros_like(terminated)
    pending_reset[0] = pending_reset_before_rollout
    for t in range(1, num_steps):
        pending_reset[t] = terminated[t - 1]
    valid = ~pending_reset
    pending_reset_after = terminated[-1].clone()
    return valid, pending_reset_after


def collect_rollout(
    env: RolloutVectorEnv,
    policy: ActorCriticPolicy,
    num_steps: int,
    obs: np.ndarray,
    pending_reset: torch.Tensor,
) -> tuple[RolloutBuffer, np.ndarray, torch.Tensor]:
    """Drives `env` for `num_steps` calls, storing every `(featurize(obs),
    action, log_prob, value, reward, terminated)` the policy/env produce.
    `pending_reset` carries the autoreset-masking state in from a prior
    rollout (or all-`False` at the very start of training, right after
    `env.reset()`). Returns `(buffer, next_obs, next_pending_reset)` --
    `next_obs`/`next_pending_reset` feed the following call so a training
    loop's rollouts compose into one continuous stream of sub-envs."""
    num_envs = env.num_envs
    obs_dim = obs.shape[1]
    num_components = len(policy.nvec)

    obs_buf = torch.zeros((num_steps, num_envs, obs_dim), dtype=torch.float32)
    actions_buf = torch.zeros((num_steps, num_envs, num_components), dtype=torch.int64)
    log_probs_buf = torch.zeros((num_steps, num_envs), dtype=torch.float32)
    values_buf = torch.zeros((num_steps, num_envs), dtype=torch.float32)
    rewards_buf = torch.zeros((num_steps, num_envs), dtype=torch.float32)
    terminated_buf = torch.zeros((num_steps, num_envs), dtype=torch.bool)

    current_obs = obs
    for t in range(num_steps):
        features = featurize(current_obs)
        obs_tensor = torch.as_tensor(features, dtype=torch.float32)
        with torch.no_grad():
            actions, log_prob, _entropy, value = policy.act(obs_tensor)

        obs_buf[t] = obs_tensor
        actions_buf[t] = actions
        log_probs_buf[t] = log_prob
        values_buf[t] = value

        next_obs, rewards, terminated, truncated, _info = env.step(actions.numpy())
        if bool(np.asarray(truncated).any()):
            raise RuntimeError(
                "collect_rollout: WarwrightVectorEnv must never truncate; a wrapped env "
                "reported truncated=True, which this masking scheme does not handle."
            )

        rewards_buf[t] = torch.as_tensor(np.asarray(rewards), dtype=torch.float32)
        terminated_buf[t] = torch.as_tensor(np.asarray(terminated), dtype=torch.bool)
        current_obs = next_obs

    valid_buf, next_pending_reset = mask_invalid_steps(terminated_buf, pending_reset)

    buffer = RolloutBuffer(
        obs=obs_buf,
        actions=actions_buf,
        log_probs=log_probs_buf,
        values=values_buf,
        rewards=rewards_buf,
        terminated=terminated_buf,
        valid=valid_buf,
    )
    return buffer, current_obs, next_pending_reset


def compute_gae(
    rewards: torch.Tensor,
    values: torch.Tensor,
    terminated: torch.Tensor,
    last_value: torch.Tensor,
    gamma: float,
    gae_lambda: float,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Standard GAE (Schulman et al. 2015), CleanRL-style, over the full
    `(num_steps, num_envs)` buffer -- including any NEXT_STEP autoreset
    boundary steps, WITHOUT special-casing them.

    This is deliberate and safe: `terminated[t]` gates the bootstrap
    (`nextnonterminal = 1 - terminated[t]`) at every index, so a real
    episode's final step (`terminated[t] = True`) already has its
    bootstrap zeroed regardless of what garbage reward/value the
    FABRICATED boundary step at `t + 1` holds -- the backward GAE
    recursion's `lastgaelam` contribution from `t + 1` is multiplied by
    that same zeroed `nextnonterminal[t]` before it can reach `advantages[t]`
    (see `test_compute_gae_terminal_step_does_not_bootstrap_past_termination`).
    The boundary step's own (meaningless) advantage is simply never used:
    `ppo_update` drops every `valid[t, e] = False` sample before forming
    minibatches.
    """
    num_steps = rewards.shape[0]
    advantages = torch.zeros_like(rewards)
    last_gae_lam = torch.zeros_like(last_value)
    for t in reversed(range(num_steps)):
        next_nonterminal = 1.0 - terminated[t].float()
        next_value = last_value if t == num_steps - 1 else values[t + 1]
        delta = rewards[t] + gamma * next_value * next_nonterminal - values[t]
        last_gae_lam = delta + gamma * gae_lambda * next_nonterminal * last_gae_lam
        advantages[t] = last_gae_lam
    returns = advantages + values
    return advantages, returns


def ppo_update(
    policy: ActorCriticPolicy,
    optimizer: optim.Optimizer,
    buffer: RolloutBuffer,
    advantages: torch.Tensor,
    returns: torch.Tensor,
    config: PPOConfig,
) -> dict[str, float]:
    """One PPO update (`config.update_epochs` passes over
    `config.num_minibatches` minibatches) over ONLY the `valid` samples in
    `buffer` -- every `valid[t, e] = False` (NEXT_STEP autoreset boundary)
    sample is dropped before minibatching, per `mask_invalid_steps`'s
    contract. Mutates `policy`'s parameters via `optimizer`. Returns mean
    loss components for logging/assertions."""
    num_steps, num_envs = buffer.rewards.shape
    valid_mask = buffer.valid.reshape(-1)

    flat_obs = buffer.obs.reshape(num_steps * num_envs, -1)[valid_mask]
    flat_actions = buffer.actions.reshape(num_steps * num_envs, -1)[valid_mask]
    flat_log_probs = buffer.log_probs.reshape(-1)[valid_mask]
    flat_advantages = advantages.reshape(-1)[valid_mask]
    flat_returns = returns.reshape(-1)[valid_mask]
    flat_values = buffer.values.reshape(-1)[valid_mask]

    num_valid = flat_obs.shape[0]
    if num_valid == 0:
        raise RuntimeError("ppo_update: every buffered step was an autoreset boundary")

    normalized_advantages = (flat_advantages - flat_advantages.mean()) / (
        flat_advantages.std() + 1e-8
    )

    minibatch_size = max(1, num_valid // config.num_minibatches)
    policy_losses: list[float] = []
    value_losses: list[float] = []
    entropy_losses: list[float] = []

    for _epoch in range(config.update_epochs):
        permutation = torch.randperm(num_valid)
        for start in range(0, num_valid, minibatch_size):
            batch_indices = permutation[start : start + minibatch_size]
            if batch_indices.numel() == 0:
                continue

            new_log_prob, entropy, new_value = policy.evaluate_actions(
                flat_obs[batch_indices], flat_actions[batch_indices]
            )
            log_ratio = new_log_prob - flat_log_probs[batch_indices]
            ratio = log_ratio.exp()

            batch_advantages = normalized_advantages[batch_indices]
            unclipped = -batch_advantages * ratio
            clipped = -batch_advantages * torch.clamp(
                ratio, 1.0 - config.clip_coef, 1.0 + config.clip_coef
            )
            policy_loss = torch.max(unclipped, clipped).mean()

            value_loss = 0.5 * (new_value - flat_returns[batch_indices]).pow(2).mean()
            entropy_loss = entropy.mean()

            loss = policy_loss - config.ent_coef * entropy_loss + config.vf_coef * value_loss

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(policy.parameters(), config.max_grad_norm)
            optimizer.step()

            policy_losses.append(float(policy_loss.item()))
            value_losses.append(float(value_loss.item()))
            entropy_losses.append(float(entropy_loss.item()))

    return {
        "policy_loss": float(np.mean(policy_losses)),
        "value_loss": float(np.mean(value_losses)),
        "entropy": float(np.mean(entropy_losses)),
        "num_valid_samples": num_valid,
        # unused but kept for symmetry with flat_values (debug-only, avoids
        # an unused-variable lint warning while documenting what's
        # available to a future caller that wants the pre-update baseline).
        "mean_value_estimate": float(flat_values.mean().item()),
    }


def train(
    env: RolloutVectorEnv,
    config: PPOConfig,
    policy: ActorCriticPolicy,
) -> tuple[ActorCriticPolicy, dict[str, float]]:
    """Runs PPO updates until `config.total_timesteps` env-steps (summed
    across sub-envs) have been collected. `env` must already be wrapped
    with `RewardShapingWrapper` (this loop reads `env`'s reward as the
    training signal verbatim -- see the module docstring). `policy` must
    already be sized from the env's observation/action spaces (this
    module's minimal `RolloutVectorEnv` Protocol deliberately does not
    expose `single_action_space`, so construction is the caller's
    responsibility -- see `smoke_run.py`). Returns the trained policy and
    the final update's loss dict."""
    seed_everything(config.seed)

    obs, _info = env.reset(seed=config.seed)

    optimizer = optim.Adam(policy.parameters(), lr=config.learning_rate, eps=1e-5)

    pending_reset = torch.zeros(config.num_envs, dtype=torch.bool)
    steps_per_rollout = config.num_steps * config.num_envs
    num_updates = max(1, config.total_timesteps // steps_per_rollout)

    last_losses: dict[str, float] = {}
    total_reward_sum = 0.0
    for _update in range(num_updates):
        buffer, obs, pending_reset = collect_rollout(
            env, policy, config.num_steps, obs, pending_reset
        )
        total_reward_sum += float(buffer.rewards[buffer.valid].sum().item())
        with torch.no_grad():
            last_value = policy.value(torch.as_tensor(featurize(obs), dtype=torch.float32))
        advantages, returns = compute_gae(
            buffer.rewards,
            buffer.values,
            buffer.terminated,
            last_value,
            config.gamma,
            config.gae_lambda,
        )
        last_losses = ppo_update(policy, optimizer, buffer, advantages, returns, config)

    last_losses["total_reward_sum"] = total_reward_sum
    return policy, last_losses
