"""Random-policy rollout test (#63 SUB_PLAN "Random-policy rollout
(pytest)"): seeds a Python random.Random, drives a small batch of envs
through the bridge to done, and asserts the whole trajectory (chosen
actions plus terminal results) is IDENTICAL across two runs given the same
seed -- the gym-determinism DoD line. This exercises Python driving the
real core (through the bridge) end to end with actions actually flowing
in, not just an autoplay match.
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import Any

from warwright_gym.actions import encode_action
from warwright_gym.transport import Transport

NUM_ENVS = 4
TICKS_PER_STEP = 20
# 300 * 20 = 6000 ticks, at least the core's internal MATCH_TICK_CAP: every
# match is guaranteed to reach `done` (win, loss, or tick-cap draw) at or
# before that, so this bounds the loop without risking a false "stuck" read.
MAX_ROUNDS = 320


def _replay_for(seed: int) -> dict[str, Any]:
    # A lone external unit (the "agent") against a lone autonomous unit
    # already in range, so a match makes progress and terminates even when
    # the random policy mostly idles.
    return {
        "version": 1,
        "seed": seed,
        "buildA": {
            "name": "Rollout A",
            "units": [
                {
                    "roleId": "reaver",
                    "skillIds": [],
                    "behaviorId": "external",
                    "position": {"x": 0, "y": 0},
                }
            ],
        },
        "buildB": {
            "name": "Rollout B",
            "units": [
                {
                    "roleId": "mender",
                    "skillIds": [],
                    "behaviorId": "aggro-lowest-hp",
                    "position": {"x": 10, "y": 0},
                }
            ],
        },
    }


def _random_action(rng: random.Random) -> dict[str, Any]:
    choice = rng.choice(["idle", "attack", "move-toward"])
    if choice == "idle":
        return {"kind": "idle"}
    if choice == "attack":
        return {"kind": "attack", "targetId": 1}
    return {"kind": "move-toward", "targetId": 1}


def _rollout(bridge_path: Path, seed: int) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    trajectory: list[dict[str, Any]] = []

    with Transport(bridge_path) as transport:
        reset_envs = [
            {"envId": env_id, "replay": _replay_for(seed * 1000 + env_id)}
            for env_id in range(NUM_ENVS)
        ]
        frames = {frame["envId"]: frame for frame in transport.reset(reset_envs)}
        done = {env_id: frames[env_id]["done"] for env_id in range(NUM_ENVS)}

        for _ in range(MAX_ROUNDS):
            if all(done.values()):
                break

            step_envs = []
            for env_id in range(NUM_ENVS):
                if done[env_id]:
                    continue
                action = _random_action(rng)
                trajectory.append({"envId": env_id, "action": action})
                step_envs.append(
                    {
                        "envId": env_id,
                        "ticks": TICKS_PER_STEP,
                        "actions": {"0": encode_action(action)},
                    }
                )

            frames = {frame["envId"]: frame for frame in transport.step(step_envs)}
            for env_id, frame in frames.items():
                done[env_id] = frame["done"]
                if frame["done"]:
                    trajectory.append({"envId": env_id, "result": frame["result"]})

    assert all(done.values()), "every env must reach done within MAX_ROUNDS"
    return trajectory


def test_random_policy_rollout_reaches_done_with_a_winner_for_every_env(bridge_path):
    trajectory = _rollout(bridge_path, seed=7)

    results = [entry["result"] for entry in trajectory if "result" in entry]
    assert len(results) == NUM_ENVS
    for result in results:
        assert result["winner"] in ("A", "B", "draw")


def test_random_policy_rollout_is_deterministic_given_the_same_seed(bridge_path):
    first = _rollout(bridge_path, seed=11)
    second = _rollout(bridge_path, seed=11)

    assert first == second
