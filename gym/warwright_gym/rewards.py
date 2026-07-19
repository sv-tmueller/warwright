"""Reward-shaping module (#127) over `WarwrightVectorEnv` (or any vector
env producing the same raw observation layout). This module NEVER
re-implements a game rule -- it only differences integer hp values the core
already emitted in the env's own observations, and reads the terminal
winner the env already computed. See gym/ENCODING.md's "Reward shaping"
addendum for the full contract and the potential-based-shaping argument
(potential-based in form, but not strictly policy-invariant -- see below
and `RewardShapingWrapper`'s docstring).

Signal sources -- NOTHING ELSE:
  - Terminal: `info["winner"]` on a sub-env's terminal frame (`"A"` -> win,
    `"B"` -> loss, `"draw"` -> draw; the trainable agent is always team A
    per `WarwrightVectorEnv._validate_builds`).
  - Shaping: integer hp deltas between consecutive RAW int64 observations,
    read at the `observation.py` layout offsets, allies-then-enemies block
    order. Hp is clamped at 0 before differencing so overkill never counts
    as extra damage. Each term is normalized by that team's total maxHp,
    read once from the FIRST reset frame this wrapper ever sees.

`RewardShapingWrapper` always operates on the RAW integer observation (pure
Python/numpy, no torch): `warwright_gym.featurize.featurize()` is applied
downstream, inside the training/eval loop, never here -- that keeps this
module's hp-delta math exact.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from gymnasium.vector import VectorEnv, VectorWrapper

from warwright_gym.observation import (
    OBS_SELF_FIELD_COUNT,
    OBS_SELF_HP_INDEX,
    OBS_SELF_MAX_HP_INDEX,
    OBS_UNIT_FIELD_COUNT,
    OBS_UNIT_HP_OFFSET,
    OBS_UNIT_MAX_HP_OFFSET,
)

_WINNER_A = "A"
_WINNER_B = "B"
_WINNER_DRAW = "draw"


@dataclass(frozen=True)
class RewardConfig:
    """Reward-shaping weights and per-term enable toggles.
    `dataclasses.asdict`-serializable so a run report can embed the exact
    configuration a policy was trained under."""

    win_reward: float = 1.0
    loss_reward: float = -1.0
    draw_reward: float = 0.0
    damage_dealt_weight: float = 0.5
    ally_hp_weight: float = 0.1
    enable_terminal: bool = True
    enable_damage_dealt: bool = True
    enable_ally_hp: bool = True


def _num_unit_blocks_for(length: int, num_allies: int) -> int:
    remainder = length - OBS_SELF_FIELD_COUNT
    if remainder < 0 or remainder % OBS_UNIT_FIELD_COUNT != 0:
        raise ValueError(
            f"RewardShapingWrapper: observation length {length} does not decompose "
            f"into a self block ({OBS_SELF_FIELD_COUNT}) plus a whole number of unit "
            f"blocks ({OBS_UNIT_FIELD_COUNT} each)"
        )
    num_unit_blocks = remainder // OBS_UNIT_FIELD_COUNT
    if num_allies > num_unit_blocks:
        raise ValueError(
            f"RewardShapingWrapper: num_allies {num_allies} exceeds the "
            f"{num_unit_blocks} unit blocks in a length-{length} observation"
        )
    return num_unit_blocks


def _unit_hp_offset(slot: int) -> int:
    return OBS_SELF_FIELD_COUNT + slot * OBS_UNIT_FIELD_COUNT + OBS_UNIT_HP_OFFSET


def _unit_max_hp_offset(slot: int) -> int:
    return OBS_SELF_FIELD_COUNT + slot * OBS_UNIT_FIELD_COUNT + OBS_UNIT_MAX_HP_OFFSET


def _team_hp_sums(row: np.ndarray, num_allies: int, num_unit_blocks: int) -> tuple[int, int]:
    """(self+allies hp sum, enemies hp sum), each clamped at 0 per-unit
    before summing so overkill never counts as extra damage."""
    team_hp = max(int(row[OBS_SELF_HP_INDEX]), 0)
    for slot in range(num_allies):
        team_hp += max(int(row[_unit_hp_offset(slot)]), 0)
    enemy_hp = 0
    for slot in range(num_allies, num_unit_blocks):
        enemy_hp += max(int(row[_unit_hp_offset(slot)]), 0)
    return team_hp, enemy_hp


def _team_max_hp_sums(row: np.ndarray, num_allies: int, num_unit_blocks: int) -> tuple[int, int]:
    """(self+allies maxHp sum, enemies maxHp sum) -- the fixed normalizers,
    read once from the first reset frame (see `RewardShapingWrapper`)."""
    team_max_hp = int(row[OBS_SELF_MAX_HP_INDEX])
    for slot in range(num_allies):
        team_max_hp += int(row[_unit_max_hp_offset(slot)])
    enemy_max_hp = 0
    for slot in range(num_allies, num_unit_blocks):
        enemy_max_hp += int(row[_unit_max_hp_offset(slot)])
    return team_max_hp, enemy_max_hp


class RewardShapingWrapper(VectorWrapper):
    """A `gymnasium.vector.VectorWrapper` around a `WarwrightVectorEnv`
    (or any vector env emitting the same raw observation layout) that
    replaces the always-`0.0` base reward with a shaped one:

        reward = terminal_term + damage_dealt_term + ally_hp_term

    `num_allies` (the count of ally blocks preceding the enemy blocks in
    every unit-block observation, i.e. `len(build_a.units) - 1`) must be
    passed explicitly: it is not part of any public env attribute, and this
    module never reads env-private state.

    Potential-based in form (see gym/ENCODING.md): the hp-delta shaping
    terms are `Phi(s') - Phi(s)` for a fixed potential function of
    normalized team hp -- the `gamma = 1` case of Ng, Harada & Russell
    1999. This is NOT strict Ng-Harada-Russell policy invariance: that
    theorem also requires `Phi = 0` at terminal states, which does not
    hold here, so the shaping adds a trajectory-dependent
    `Phi(s_T) - Phi(s_0)` term on top of the terminal win/loss reward --
    a deliberate bias toward hp-conserving, high-margin wins, not a
    policy-invariant transform.

    Autoreset-safe: `WarwrightVectorEnv` uses `AutoresetMode.NEXT_STEP`, so
    the frame immediately after a terminal frame is a brand-new episode,
    not a real transition. This wrapper tracks `terminated` per sub-env
    from the PREVIOUS `step()` call; on such a boundary frame the shaping
    reward is `0.0` and `prev_obs` is re-baselined from the fresh frame
    instead of being diffed against the stale terminal frame. `reset()`
    always re-baselines `prev_obs` too.
    """

    def __init__(
        self,
        env: VectorEnv,
        config: RewardConfig | None = None,
        *,
        num_allies: int,
    ) -> None:
        super().__init__(env)
        if num_allies < 0:
            raise ValueError(f"RewardShapingWrapper: num_allies must be >= 0, got {num_allies}")
        self.config = config if config is not None else RewardConfig()
        self._num_allies = num_allies

        self._prev_obs: np.ndarray | None = None
        self._prev_terminated = np.zeros(self.num_envs, dtype=bool)
        # Cached from the FIRST reset frame this wrapper ever sees, never
        # recomputed afterward (see class docstring / ENCODING.md).
        self._team_max_hp: np.ndarray | None = None
        self._enemy_max_hp: np.ndarray | None = None

    def _capture_max_hp(self, raw_obs: np.ndarray) -> None:
        num_unit_blocks = _num_unit_blocks_for(raw_obs.shape[-1], self._num_allies)
        team_max_hp = np.zeros(raw_obs.shape[0], dtype=np.float64)
        enemy_max_hp = np.zeros(raw_obs.shape[0], dtype=np.float64)
        for env_id in range(raw_obs.shape[0]):
            team, enemy = _team_max_hp_sums(raw_obs[env_id], self._num_allies, num_unit_blocks)
            team_max_hp[env_id] = team
            enemy_max_hp[env_id] = enemy
        self._team_max_hp = team_max_hp
        self._enemy_max_hp = enemy_max_hp

    def reset(
        self,
        *,
        seed: int | list[int] | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        raw_obs, info = self.env.reset(seed=seed, options=options)
        if self._team_max_hp is None:
            self._capture_max_hp(raw_obs)
        self._prev_obs = raw_obs.copy()
        self._prev_terminated = np.zeros(self.num_envs, dtype=bool)
        return raw_obs, info

    def _shaping_for(
        self, env_id: int, prev_row: np.ndarray, cur_row: np.ndarray, num_unit_blocks: int
    ) -> float:
        config = self.config
        prev_team_hp, prev_enemy_hp = _team_hp_sums(prev_row, self._num_allies, num_unit_blocks)
        cur_team_hp, cur_enemy_hp = _team_hp_sums(cur_row, self._num_allies, num_unit_blocks)

        shaping = 0.0
        if config.enable_damage_dealt:
            enemy_max_hp = max(float(self._enemy_max_hp[env_id]), 1.0)
            damage_dealt = prev_enemy_hp - cur_enemy_hp  # net of enemy healing
            shaping += config.damage_dealt_weight * damage_dealt / enemy_max_hp
        if config.enable_ally_hp:
            team_max_hp = max(float(self._team_max_hp[env_id]), 1.0)
            ally_hp_delta = cur_team_hp - prev_team_hp
            shaping += config.ally_hp_weight * ally_hp_delta / team_max_hp
        return shaping

    def _terminal_for(self, env_id: int, info: dict[str, Any], terminated: bool) -> float:
        if not terminated or not self.config.enable_terminal:
            return 0.0
        winner = info["winner"][env_id]
        if winner == _WINNER_A:
            return self.config.win_reward
        if winner == _WINNER_B:
            return self.config.loss_reward
        if winner == _WINNER_DRAW:
            return self.config.draw_reward
        raise ValueError(f"RewardShapingWrapper: unknown winner {winner!r} for env {env_id}")

    def step(
        self, actions: Any
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
        raw_obs, _base_rewards, terminated, truncated, info = self.env.step(actions)
        if self._prev_obs is None:
            raise RuntimeError("RewardShapingWrapper.step() called before reset()")

        num_unit_blocks = _num_unit_blocks_for(raw_obs.shape[-1], self._num_allies)
        rewards = np.zeros(self.num_envs, dtype=np.float64)
        for env_id in range(self.num_envs):
            if self._prev_terminated[env_id]:
                # Autoreset boundary (AutoresetMode.NEXT_STEP): this frame
                # is a fresh, full-hp episode, not a real transition from
                # the prior terminal frame -- 0.0 shaping, re-baseline only
                # (below, unconditionally).
                rewards[env_id] = 0.0
            else:
                rewards[env_id] = self._shaping_for(
                    env_id, self._prev_obs[env_id], raw_obs[env_id], num_unit_blocks
                )
                rewards[env_id] += self._terminal_for(env_id, info, bool(terminated[env_id]))

        self._prev_obs = raw_obs.copy()
        self._prev_terminated = np.asarray(terminated, dtype=bool).copy()
        return raw_obs, rewards, terminated, truncated, info
