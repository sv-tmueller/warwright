"""Pinned-seed evaluation harness for #65: measures a policy's win rate
over a FIXED set of matches, identical across any two policies being
compared (so a before/after training delta is a real apples-to-apples
comparison, not an artifact of different seed sequences).

Why pinning matters: `WarwrightVectorEnv`'s per-sub-env replay seeds are
drawn from `self.np_random` once per `reset()` and again per NEXT_STEP
autoreset boundary (see gym/ENCODING.md's "Seeding derivation") -- under
autoreset, how many steps a sub-env's FIRST episode takes (and therefore
which seed its second episode draws) depends on the POLICY. Two different
policies would therefore see different matches after their first episode
if we just called `reset(seed=...)` once and read every winner off a long
autoreset rollout. The protocol below sidesteps that entirely: call
`reset(seed=seed_base + batch_index)` for each of `num_batches` batches of
`env.num_envs` sub-envs, and record ONLY each sub-env's FIRST terminal
winner in that batch -- the first `env.num_envs` replay seeds drawn from a
given `reset(seed=...)` call are a pure function of that seed, so this
matrix of `(num_batches, env.num_envs)` seeds -- and therefore the set of
matches played -- is identical for any policy evaluated this way.

`EVAL_SEED_BASE`/`EVAL_BATCH_SIZE`/`EVAL_NUM_BATCHES` below are the fixed
constants `smoke_run.py` uses (16 x 4 = N = 64 matches, per the #65
SUB_PLAN); `evaluate()` itself takes `seed_base`/`num_batches` as
parameters so tests (and any future re-tuning) are not locked to those
exact values.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

import numpy as np
import torch

from warwright_gym.actions import ACTION_KIND_ATTACK, ACTION_KIND_MOVE_TOWARD
from warwright_gym.featurize import featurize
from warwright_gym.observation import (
    OBS_SELF_FIELD_COUNT,
    OBS_UNIT_DISTANCE_SQUARED_OFFSET,
    OBS_UNIT_FIELD_COUNT,
    OBS_UNIT_HP_OFFSET,
)

if TYPE_CHECKING:
    from warwright_gym.training.policy import ActorCriticPolicy

EVAL_BATCH_SIZE = 16
EVAL_NUM_BATCHES = 4
# Arbitrary, fixed base for the pinned evaluation seeds -- large enough to
# never collide with a training-run seed (which starts at a small
# human-chosen integer per PPOConfig.seed) by accident.
EVAL_SEED_BASE = 1_000_000

# A generic proximity cutoff for the HEURISTIC policy's attack-vs-move
# choice (`move-toward` beyond this squared distance, `attack` within it).
# Deliberately NOT one of any role's actual `attackRangeSquared` (that
# would be duplicating core content data, a rule) -- just a heuristic
# action-selection parameter; an out-of-range `attack` is a harmless no-op
# (see gym/ENCODING.md's "Invalid-but-well-formed actions are NOT
# filtered"), so an overly generous cutoff only costs a wasted tick, never
# correctness.
HEURISTIC_ENGAGE_DISTANCE_SQUARED = 10_000

# Generous upper bound on env.step() calls per evaluation batch: the core's
# own MATCH_TICK_CAP is 6000 ticks; at ticks_per_step=20 that is 300 calls,
# so 400 leaves headroom without risking masking a real "stuck" bug as a
# clean timeout.
MAX_EVAL_STEPS = 400


class ActionPolicy(Protocol):
    """The minimal interface `evaluate()` needs from a policy: map a batch
    of raw int64 observations to a batch of wire-shaped MultiDiscrete
    actions (`(num_envs, 5)`, `[kind, target_slot, skill_index, move_x,
    move_y]` per row)."""

    def act(self, obs: np.ndarray) -> np.ndarray: ...


class EvalVectorEnv(Protocol):
    num_envs: int

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]: ...

    def step(
        self, actions: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]: ...


class HeuristicPolicy:
    """Scripted baseline: each sub-env, each step, picks the lowest-hp
    ALIVE enemy slot (action CHOICE only -- no game rule is read or
    duplicated) and either `attack`s it (within
    `HEURISTIC_ENGAGE_DISTANCE_SQUARED`) or `move-toward`s it (otherwise).
    Reads hp/distance directly from the raw int64 observation at
    `warwright_gym.observation`'s layout offsets. Never targets an ally
    slot (the first `num_allies` unit blocks)."""

    def __init__(self, num_allies: int, num_enemies: int) -> None:
        self._num_allies = num_allies
        self._num_enemies = num_enemies

    def act(self, obs: np.ndarray) -> np.ndarray:
        num_envs = obs.shape[0]
        actions = np.zeros((num_envs, 5), dtype=np.int64)
        for env_id in range(num_envs):
            row = obs[env_id]
            best_slot: int | None = None
            best_hp: int | None = None
            for offset in range(self._num_enemies):
                slot = self._num_allies + offset
                base = OBS_SELF_FIELD_COUNT + slot * OBS_UNIT_FIELD_COUNT
                hp = int(row[base + OBS_UNIT_HP_OFFSET])
                if hp <= 0:
                    continue
                if best_hp is None or hp < best_hp:
                    best_hp = hp
                    best_slot = slot
            if best_slot is None:
                continue  # every enemy dead (or none exist): idle, kind=0
            base = OBS_SELF_FIELD_COUNT + best_slot * OBS_UNIT_FIELD_COUNT
            distance_squared = int(row[base + OBS_UNIT_DISTANCE_SQUARED_OFFSET])
            kind = (
                ACTION_KIND_ATTACK
                if distance_squared <= HEURISTIC_ENGAGE_DISTANCE_SQUARED
                else ACTION_KIND_MOVE_TOWARD
            )
            actions[env_id] = [kind, best_slot, 0, 0, 0]
        return actions


class TorchPolicyAdapter:
    """Adapts an `ActorCriticPolicy` to `ActionPolicy`: applies
    `warwright_gym.featurize.featurize` to the raw int64 observation (the
    policy's input contract -- see featurize.py's docstring) and always
    acts DETERMINISTICALLY (argmax per component), per the #65 SUB_PLAN's
    eval protocol."""

    def __init__(self, policy: ActorCriticPolicy) -> None:
        self._policy = policy

    def act(self, obs: np.ndarray) -> np.ndarray:
        features = featurize(obs)
        with torch.no_grad():
            actions, _log_prob, _entropy, _value = self._policy.act(
                torch.as_tensor(features, dtype=torch.float32), deterministic=True
            )
        return actions.numpy().astype(np.int64)


@dataclass(frozen=True)
class EvalResult:
    """Win rate over `num_matches` FIXED, pinned-seed matches (see the
    module docstring). `winners` is one `"A" | "B" | "draw"` entry per
    match, in `(batch, sub_env)` order."""

    win_rate: float
    wins: int
    losses: int
    draws: int
    num_matches: int
    winners: list[str]


def evaluate(
    env: EvalVectorEnv,
    policy: ActionPolicy,
    *,
    num_batches: int = EVAL_NUM_BATCHES,
    seed_base: int = EVAL_SEED_BASE,
) -> EvalResult:
    """Runs `num_batches` batches of `env.num_envs` pinned-seed matches
    (`reset(seed=seed_base + batch_index)`), recording ONLY each sub-env's
    FIRST terminal winner. Any subsequent NEXT_STEP-autoreset episode
    within the same batch (if the loop keeps running for other, slower
    sub-envs) is ignored -- it is not part of the pinned match set."""
    winners: list[str] = []
    for batch_index in range(num_batches):
        obs, _info = env.reset(seed=seed_base + batch_index)
        num_envs = env.num_envs
        done = np.zeros(num_envs, dtype=bool)
        batch_winners: list[str | None] = [None] * num_envs

        for _step in range(MAX_EVAL_STEPS):
            if done.all():
                break
            actions = policy.act(obs)
            obs, _rewards, terminated, truncated, info = env.step(actions)
            if bool(np.asarray(truncated).any()):
                raise RuntimeError("evaluate: WarwrightVectorEnv must never truncate")
            for env_id in range(num_envs):
                if not done[env_id] and terminated[env_id]:
                    batch_winners[env_id] = info["winner"][env_id]
            done = done | terminated

        if not done.all():
            raise RuntimeError(
                f"evaluate: batch {batch_index} did not reach done for every sub-env "
                f"within MAX_EVAL_STEPS={MAX_EVAL_STEPS}"
            )

        assert all(winner is not None for winner in batch_winners)
        winners.extend(batch_winners)  # type: ignore[arg-type]

    wins = winners.count("A")
    losses = winners.count("B")
    draws = winners.count("draw")
    return EvalResult(
        win_rate=wins / len(winners),
        wins=wins,
        losses=losses,
        draws=draws,
        num_matches=len(winners),
        winners=winners,
    )
