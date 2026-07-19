"""Actor-critic MLP policy for #65's PPO loop, over a MultiDiscrete action
space (`WarwrightVectorEnv.single_action_space`'s `nvec`, e.g.
`[5, T, 6, 1001, 1001]`). Deliberately small and export-friendly for #66's
future TypeScript float64 inference Behavior: a fixed trunk of plain
`Linear` + `tanh` layers in a fixed op order, a linear actor head split
into one independent `Categorical` per `nvec` component, and a linear
critic head. No `nn.Sequential`, no conditional branching in `forward` --
the op order here IS the op order #66 must mirror.

Input is the FLOAT feature vector `warwright_gym.featurize.featurize`
produces (shape `(L,)`), never the raw int64 observation -- see that
module's docstring for why featurization lives outside the env.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import torch
from torch import nn
from torch.distributions import Categorical

HIDDEN_SIZES: tuple[int, int] = (64, 64)


def _orthogonal_layer(in_features: int, out_features: int, gain: float) -> nn.Linear:
    """A `nn.Linear` with CleanRL-style orthogonal weight init and a
    zeroed bias -- the standard PPO init (Schulman et al.) that keeps
    early rollouts from saturating `tanh` or collapsing the actor's
    initial action distribution."""
    layer = nn.Linear(in_features, out_features)
    nn.init.orthogonal_(layer.weight, gain=gain)
    nn.init.zeros_(layer.bias)
    return layer


class ActorCriticPolicy(nn.Module):
    """`obs_dim` floats in -> a shared tanh([64, 64]) trunk -> a split
    actor head (one independent `Categorical` per `nvec` component) and a
    scalar critic head.

    Actor and critic each read the SAME trunk output (standard shared-body
    actor-critic); this keeps the network small and matches CleanRL's
    `ppo.py` reference architecture, adapted here for `MultiDiscrete`
    heads.
    """

    def __init__(
        self,
        obs_dim: int,
        nvec: Sequence[int],
        hidden_sizes: tuple[int, int] = HIDDEN_SIZES,
    ) -> None:
        super().__init__()
        self.obs_dim = obs_dim
        self.nvec = list(int(n) for n in nvec)

        hidden_a, hidden_b = hidden_sizes
        gain = float(np.sqrt(2))
        self.trunk_layer_1 = _orthogonal_layer(obs_dim, hidden_a, gain=gain)
        self.trunk_layer_2 = _orthogonal_layer(hidden_a, hidden_b, gain=gain)
        # A small actor-head gain (CleanRL's convention) keeps the initial
        # policy close to uniform per component instead of confidently
        # wrong from a random trunk.
        self.actor_head = _orthogonal_layer(hidden_b, sum(self.nvec), gain=0.01)
        self.critic_head = _orthogonal_layer(hidden_b, 1, gain=1.0)

    def _trunk(self, obs: torch.Tensor) -> torch.Tensor:
        hidden = torch.tanh(self.trunk_layer_1(obs))
        hidden = torch.tanh(self.trunk_layer_2(hidden))
        return hidden

    def actor_logits(self, obs: torch.Tensor) -> list[torch.Tensor]:
        """One logits tensor per `nvec` component, each shaped
        `(*batch, nvec[i])`."""
        hidden = self._trunk(obs)
        flat_logits = self.actor_head(hidden)
        return list(torch.split(flat_logits, self.nvec, dim=-1))

    def value(self, obs: torch.Tensor) -> torch.Tensor:
        """Scalar critic value, shaped `(*batch,)` (the trailing size-1
        dimension is squeezed)."""
        hidden = self._trunk(obs)
        return self.critic_head(hidden).squeeze(-1)

    @staticmethod
    def _as_tensor(obs: torch.Tensor | np.ndarray) -> torch.Tensor:
        if isinstance(obs, torch.Tensor):
            return obs
        return torch.as_tensor(np.asarray(obs), dtype=torch.float32)

    def act(
        self, obs: torch.Tensor | np.ndarray, deterministic: bool = False
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Sample (or, if `deterministic`, argmax) one action per `nvec`
        component. Returns `(actions, log_prob, entropy, value)`:
        `actions` is `(*batch, len(nvec))` int64, `log_prob`/`entropy`/
        `value` are each `(*batch,)`, `log_prob`/`entropy` summed over
        components (independent per-component distributions -> joint
        log-prob/entropy is the sum)."""
        obs_tensor = self._as_tensor(obs)
        hidden = self._trunk(obs_tensor)
        flat_logits = self.actor_head(hidden)
        per_component_logits = torch.split(flat_logits, self.nvec, dim=-1)

        chosen: list[torch.Tensor] = []
        log_probs: list[torch.Tensor] = []
        entropies: list[torch.Tensor] = []
        for logits in per_component_logits:
            distribution = Categorical(logits=logits)
            component_action = (
                torch.argmax(logits, dim=-1) if deterministic else distribution.sample()
            )
            chosen.append(component_action)
            log_probs.append(distribution.log_prob(component_action))
            entropies.append(distribution.entropy())

        actions = torch.stack(chosen, dim=-1)
        log_prob = torch.stack(log_probs, dim=-1).sum(dim=-1)
        entropy = torch.stack(entropies, dim=-1).sum(dim=-1)
        value = self.critic_head(hidden).squeeze(-1)
        return actions, log_prob, entropy, value

    def evaluate_actions(
        self, obs: torch.Tensor | np.ndarray, actions: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """The joint log-prob, joint entropy, and critic value of ALREADY
        CHOSEN `actions` (shape `(*batch, len(nvec))`) under the current
        policy -- the PPO update's ratio/entropy-bonus/value-loss inputs."""
        obs_tensor = self._as_tensor(obs)
        hidden = self._trunk(obs_tensor)
        flat_logits = self.actor_head(hidden)
        per_component_logits = torch.split(flat_logits, self.nvec, dim=-1)

        log_probs: list[torch.Tensor] = []
        entropies: list[torch.Tensor] = []
        for component_index, logits in enumerate(per_component_logits):
            distribution = Categorical(logits=logits)
            component_action = actions[..., component_index]
            log_probs.append(distribution.log_prob(component_action))
            entropies.append(distribution.entropy())

        log_prob = torch.stack(log_probs, dim=-1).sum(dim=-1)
        entropy = torch.stack(entropies, dim=-1).sum(dim=-1)
        value = self.critic_head(hidden).squeeze(-1)
        return log_prob, entropy, value
