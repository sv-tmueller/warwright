"""Gymnasium environment over the batched gym-bridge transport (#64).

`WarwrightVectorEnv` is the primary surface: ONE `Transport` subprocess
backs every sub-env, so `step()` is a single batched NDJSON round trip (two
on an autoreset boundary step -- see `step()` below). `WarwrightEnv` is a
thin `gymnasium.Env` wrapper over a `WarwrightVectorEnv(num_envs=1)`, kept
only so `gymnasium.utils.env_checker.check_env` can run against a
single-agent surface.

This module never re-implements a game rule. It only:
  - decodes a `MultiDiscrete([kind, target_slot, skill_index, move_x,
    move_y])` action into the wire tuple `warwright_gym.actions` already
    knows how to encode/decode (target_slot -> unit id via the observation's
    own unit-block order, read once from the reset frame);
  - reads the flat observation vector the bridge already produced (shape
    derived from `warwright_gym.observation`'s layout constants); and
  - forwards `reset`/`step`/`close` to `warwright_gym.transport.Transport`.

See gym/ENCODING.md for the full field/action tables and the seeding
derivation this module implements.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from gymnasium import Env
from gymnasium.spaces import Box, MultiDiscrete
from gymnasium.vector import AutoresetMode, VectorEnv
from gymnasium.vector.utils import batch_space

from warwright_gym.actions import SKILL_CATALOG
from warwright_gym.observation import (
    OBS_SELF_FIELD_COUNT,
    OBS_UNIT_FIELD_COUNT,
    OBS_UNIT_ID_OFFSET,
    compute_observation_length,
)
from warwright_gym.transport import Transport, default_bridge_path, ensure_bridge_built

# Mirrors packages/core/src/sim/constants.ts's EXTERNAL_BEHAVIOR_ID: the
# sentinel behaviorId whose Action is drawn from the injected `actions` map
# instead of a registered Behavior.
EXTERNAL_BEHAVIOR_ID = "external"

# Mirrors packages/core/src/sim/constants.ts's RULESET_VERSION. The replay
# `version` field is carried through, not validated against this by the
# core, but a fixed value here keeps default builds reproducible in spirit
# with the rest of the repo's fixtures.
REPLAY_VERSION = 2

# Mirrors packages/core/src/sim/constants.ts's ARENA_MAX_X/ARENA_MAX_Y (a
# square 0..1000 arena): move_x/move_y range over the same 1001 raw
# coordinate values, no discretization loss.
ARENA_MAX_COORD = 1000

# Action-kind codes, mirroring warwright_gym.actions / observation.ts's tag
# table (see that module's docstring for the full [kind, p1, p2, p3] shape).
_ACTION_KIND_IDLE = 0
_ACTION_KIND_MOVE = 1
_ACTION_KIND_MOVE_TOWARD = 2
_ACTION_KIND_ATTACK = 3
_ACTION_KIND_CAST = 4

# MultiDiscrete action vector component indices:
# [kind, target_slot, skill_index, move_x, move_y].
_ACTION_KIND_COMPONENT = 0
_ACTION_TARGET_SLOT_COMPONENT = 1
_ACTION_SKILL_INDEX_COMPONENT = 2
_ACTION_MOVE_X_COMPONENT = 3
_ACTION_MOVE_Y_COMPONENT = 4

_NUM_ACTION_KINDS = 5


def default_build_a() -> dict[str, Any]:
    """A lone external unit: the trainable agent (team A)."""
    return {
        "name": "Gym Agent",
        "units": [
            {
                "roleId": "reaver",
                "skillIds": ["cleave"],
                "behaviorId": EXTERNAL_BEHAVIOR_ID,
                "position": {"x": 0, "y": 0},
            }
        ],
    }


def default_build_b() -> dict[str, Any]:
    """A small baseline roster (team B) with registered Behaviors, close
    enough to the default build_a spawn to engage even under a mostly-idle
    policy."""
    return {
        "name": "Gym Baseline",
        "units": [
            {
                "roleId": "mender",
                "skillIds": ["mending-touch"],
                "behaviorId": "aggro-lowest-hp",
                "position": {"x": 10, "y": 0},
            },
            {
                "roleId": "warden",
                "skillIds": [],
                "behaviorId": "aggro-lowest-hp",
                "position": {"x": 20, "y": 0},
            },
        ],
    }


def _count_external_units(build: dict[str, Any]) -> int:
    return sum(1 for unit in build["units"] if unit.get("behaviorId") == EXTERNAL_BEHAVIOR_ID)


def _validate_builds(build_a: dict[str, Any], build_b: dict[str, Any]) -> None:
    count_a = _count_external_units(build_a)
    if count_a != 1:
        raise ValueError(
            "WarwrightVectorEnv requires exactly one behaviorId=='external' unit in "
            f"build_a (the trainable agent), found {count_a}"
        )
    count_b = _count_external_units(build_b)
    if count_b != 0:
        raise ValueError(
            "WarwrightVectorEnv requires zero behaviorId=='external' units in build_b "
            f"(only build_a may contain the trainable agent), found {count_b}"
        )


class WarwrightVectorEnv(VectorEnv):
    """A Gymnasium `VectorEnv` over `num_envs` matches of the SAME
    `build_a`/`build_b` pair, all stepped through one `Transport`
    subprocess per `reset()`/`step()` call (batched NDJSON round trip).

    Observation: `Box(low=-1, high=int64 max, shape=(L,), dtype=np.int64)`,
    `L` derived from the build pair and asserted against the actual reset
    frame. Action: `MultiDiscrete([5, T, S, 1001, 1001])` -- see the module
    docstring and gym/ENCODING.md.

    reward is always `0.0` (no reward shaping in #64; see #65). `info`
    carries `replay_seed` for every sub-env on every frame, and `winner`/
    `hash` (else `None`) per sub-env, set only on a frame where that
    sub-env's `terminated` is `True`.
    """

    metadata = {"autoreset_mode": AutoresetMode.NEXT_STEP}

    def __init__(
        self,
        num_envs: int,
        *,
        build_a: dict[str, Any] | None = None,
        build_b: dict[str, Any] | None = None,
        ticks_per_step: int = 20,
        bridge_path: Path | None = None,
        node: str = "node",
    ) -> None:
        super().__init__()

        self.num_envs = num_envs
        self.ticks_per_step = ticks_per_step

        self._build_a = build_a if build_a is not None else default_build_a()
        self._build_b = build_b if build_b is not None else default_build_b()
        _validate_builds(self._build_a, self._build_b)

        num_allies = len(self._build_a["units"]) - 1
        num_enemies = len(self._build_b["units"])
        self._num_target_slots = num_allies + num_enemies
        self._expected_length = compute_observation_length(num_allies, num_enemies)

        self.single_observation_space = Box(
            low=-1,
            high=np.iinfo(np.int64).max,
            shape=(self._expected_length,),
            dtype=np.int64,
        )
        self.single_action_space = MultiDiscrete(
            [_NUM_ACTION_KINDS, self._num_target_slots, len(SKILL_CATALOG),
             ARENA_MAX_COORD + 1, ARENA_MAX_COORD + 1],
            dtype=np.int64,
        )
        self.observation_space = batch_space(self.single_observation_space, num_envs)
        self.action_space = batch_space(self.single_action_space, num_envs)

        resolved_path = bridge_path if bridge_path is not None else ensure_bridge_built(
            default_bridge_path()
        )
        self._transport = Transport(resolved_path, node=node)

        self._agent_unit_id: int | None = None
        self._slot_to_unit_id: list[int] | None = None
        self._current_seeds = np.zeros(num_envs, dtype=np.int64)
        # True for a sub-env that reached `done` on the last `step()` call
        # and must be reset (not stepped) on the NEXT call --
        # AutoresetMode.NEXT_STEP.
        self._autoreset = np.zeros(num_envs, dtype=bool)

    def _replay_for(self, seed: int) -> dict[str, Any]:
        return {
            "version": REPLAY_VERSION,
            "seed": seed,
            "buildA": self._build_a,
            "buildB": self._build_b,
        }

    def _extract_agent_vector(self, frame: dict[str, Any]) -> list[int]:
        obs = frame["obs"]
        if len(obs) != 1:
            raise RuntimeError(
                f"WarwrightVectorEnv: expected exactly one external unit's observation, "
                f"got keys {list(obs.keys())!r}"
            )
        (key, vector), = obs.items()
        unit_id = int(key)
        if len(vector) != self._expected_length:
            raise RuntimeError(
                f"WarwrightVectorEnv: observation length {len(vector)} does not match "
                f"the length computed from the build pair ({self._expected_length}); "
                "the TS encoder and this env have desynced."
            )
        if self._agent_unit_id is None:
            self._agent_unit_id = unit_id
        elif self._agent_unit_id != unit_id:
            raise RuntimeError(
                f"WarwrightVectorEnv: agent unit id changed across resets "
                f"({self._agent_unit_id} -> {unit_id}); build_a must be fixed for "
                "the env's lifetime."
            )
        if self._slot_to_unit_id is None:
            self._slot_to_unit_id = [
                vector[OBS_SELF_FIELD_COUNT + slot * OBS_UNIT_FIELD_COUNT + OBS_UNIT_ID_OFFSET]
                for slot in range(self._num_target_slots)
            ]
        return vector

    def _draw_seeds(self, count: int) -> np.ndarray:
        # uint32-range replay seeds drawn from self.np_random, ascending
        # sub-env index order (a single vectorized draw enumerates in that
        # order already).
        return self.np_random.integers(0, 2**32, size=count, dtype=np.int64)

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)

        seeds = self._draw_seeds(self.num_envs)
        self._current_seeds = seeds
        reset_envs = [
            {"envId": env_id, "replay": self._replay_for(int(seeds[env_id]))}
            for env_id in range(self.num_envs)
        ]
        frames_by_id = {frame["envId"]: frame for frame in self._transport.reset(reset_envs)}

        obs = np.zeros((self.num_envs, self._expected_length), dtype=np.int64)
        for env_id in range(self.num_envs):
            obs[env_id] = self._extract_agent_vector(frames_by_id[env_id])

        self._autoreset = np.zeros(self.num_envs, dtype=bool)
        info: dict[str, Any] = {"replay_seed": self._current_seeds.copy()}
        return obs, info

    def _encode_wire_action(self, action_row: np.ndarray) -> list[int]:
        assert self._slot_to_unit_id is not None  # reset() always runs first
        kind = int(action_row[_ACTION_KIND_COMPONENT])
        target_slot = int(action_row[_ACTION_TARGET_SLOT_COMPONENT])
        skill_index = int(action_row[_ACTION_SKILL_INDEX_COMPONENT])
        move_x = int(action_row[_ACTION_MOVE_X_COMPONENT])
        move_y = int(action_row[_ACTION_MOVE_Y_COMPONENT])

        if kind == _ACTION_KIND_IDLE:
            return [_ACTION_KIND_IDLE, 0, 0, 0]
        if kind == _ACTION_KIND_MOVE:
            return [_ACTION_KIND_MOVE, move_x, move_y, 0]
        target_id = self._slot_to_unit_id[target_slot]
        if kind == _ACTION_KIND_MOVE_TOWARD:
            return [_ACTION_KIND_MOVE_TOWARD, target_id, 0, 0]
        if kind == _ACTION_KIND_ATTACK:
            return [_ACTION_KIND_ATTACK, target_id, 0, 0]
        if kind == _ACTION_KIND_CAST:
            return [_ACTION_KIND_CAST, target_id, 0, skill_index]
        raise ValueError(f"WarwrightVectorEnv: unknown action kind {kind}")

    def step(
        self, actions: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
        actions = np.asarray(actions)

        reset_envs: list[dict[str, Any]] = []
        step_envs: list[dict[str, Any]] = []
        for env_id in range(self.num_envs):
            if self._autoreset[env_id]:
                seed = int(self._draw_seeds(1)[0])
                self._current_seeds[env_id] = seed
                reset_envs.append({"envId": env_id, "replay": self._replay_for(seed)})
            else:
                wire_action = self._encode_wire_action(actions[env_id])
                step_envs.append(
                    {
                        "envId": env_id,
                        "ticks": self.ticks_per_step,
                        "actions": {str(self._agent_unit_id): wire_action},
                    }
                )

        frames_by_id: dict[int, dict[str, Any]] = {}
        if reset_envs:
            for frame in self._transport.reset(reset_envs):
                frames_by_id[frame["envId"]] = frame
        if step_envs:
            for frame in self._transport.step(step_envs):
                frames_by_id[frame["envId"]] = frame

        obs = np.zeros((self.num_envs, self._expected_length), dtype=np.int64)
        rewards = np.zeros(self.num_envs, dtype=np.float64)
        terminated = np.zeros(self.num_envs, dtype=bool)
        truncated = np.zeros(self.num_envs, dtype=bool)
        winners = np.full(self.num_envs, None, dtype=object)
        hashes = np.full(self.num_envs, None, dtype=object)

        for env_id in range(self.num_envs):
            frame = frames_by_id[env_id]
            obs[env_id] = self._extract_agent_vector(frame)
            was_autoreset = self._autoreset[env_id]
            done = frame["done"]
            if not was_autoreset and done:
                terminated[env_id] = True
                winners[env_id] = frame["result"]["winner"]
                hashes[env_id] = frame["result"]["hash"]
            # A sub-env that was just (re)started this call (whether via
            # autoreset or a fresh reset()) cannot be terminal in the SAME
            # frame -- NEXT_STEP semantics.
            self._autoreset[env_id] = done and not was_autoreset

        info: dict[str, Any] = {
            "replay_seed": self._current_seeds.copy(),
            "winner": winners,
            "hash": hashes,
        }
        return obs, rewards, terminated, truncated, info

    def close_extras(self, **kwargs: Any) -> None:
        self._transport.close()


class WarwrightEnv(Env):
    """Thin single-agent `gymnasium.Env` over a `WarwrightVectorEnv(1, ...)`
    ("the same driver"), so `gymnasium.utils.env_checker.check_env` can run.

    Not autoreset, by the standard single-env Gymnasium convention: call
    `reset()` again after a `terminated`/`truncated` step. The underlying
    `WarwrightVectorEnv` DOES autoreset internally (`AutoresetMode.NEXT_STEP`
    -- required so the vector env's sub-envs stay lockstepped), which would
    otherwise let a `step()` call after `terminated`/`truncated` silently
    autoreset (discarding the caller's action and returning a fresh episode
    instead of raising). To honor the documented single-agent contract,
    `WarwrightEnv` tracks whether the episode is awaiting `reset()` and
    raises `RuntimeError` if `step()` is called again before that -- fail
    loud instead of silently corrupting a training loop that forgot to
    reset."""

    metadata = {"render_modes": []}

    def __init__(
        self,
        *,
        build_a: dict[str, Any] | None = None,
        build_b: dict[str, Any] | None = None,
        ticks_per_step: int = 20,
        bridge_path: Path | None = None,
        node: str = "node",
    ) -> None:
        super().__init__()
        self._vector_env = WarwrightVectorEnv(
            1,
            build_a=build_a,
            build_b=build_b,
            ticks_per_step=ticks_per_step,
            bridge_path=bridge_path,
            node=node,
        )
        self.observation_space = self._vector_env.single_observation_space
        self.action_space = self._vector_env.single_action_space
        # Set by step() when terminated/truncated; cleared by reset(). Guards
        # against the underlying WarwrightVectorEnv's NEXT_STEP autoreset
        # silently absorbing a step() call this class's docstring says must
        # be a reset() instead.
        self._awaiting_reset = False

    @staticmethod
    def _scalar_info(info: dict[str, Any], index: int) -> dict[str, Any]:
        result: dict[str, Any] = {"replay_seed": int(info["replay_seed"][index])}
        winner = info.get("winner")
        if winner is not None and winner[index] is not None:
            result["winner"] = winner[index]
            result["hash"] = int(info["hash"][index])
        return result

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        obs, info = self._vector_env.reset(seed=seed, options=options)
        self._awaiting_reset = False
        return obs[0], self._scalar_info(info, 0)

    def step(self, action: np.ndarray) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        if self._awaiting_reset:
            raise RuntimeError(
                "WarwrightEnv.step() called after a terminated/truncated episode "
                "without an intervening reset(). The underlying WarwrightVectorEnv "
                "autoresets (AutoresetMode.NEXT_STEP), which would otherwise "
                "silently discard this action and start a new episode; call "
                "reset() first."
            )
        obs, rewards, terminated, truncated, info = self._vector_env.step(
            np.asarray([action])
        )
        self._awaiting_reset = bool(terminated[0]) or bool(truncated[0])
        return (
            obs[0],
            float(rewards[0]),
            bool(terminated[0]),
            bool(truncated[0]),
            self._scalar_info(info, 0),
        )

    def close(self) -> None:
        self._vector_env.close()
