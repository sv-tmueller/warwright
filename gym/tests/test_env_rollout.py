"""Vectorized rollout + gym-determinism tests for WarwrightVectorEnv (#64).
Drives the real core through the env API (never a mock): a seeded
random-policy rollout runs every sub-env to `done`, and two runs with the
same seed must produce byte-identical stacked trajectories (observations,
terminations, winners, and event-log hashes) -- the gym-determinism DoD
line, extended from #63's random-rollout test to the env surface itself.
"""

from __future__ import annotations

import numpy as np

from warwright_gym.env import WarwrightVectorEnv

NUM_ENVS = 4
TICKS_PER_STEP = 20
# 320 * 20 = 6400 ticks, at least the core's MATCH_TICK_CAP (6000): every
# sub-env reaches `done` (win, loss, or tick-cap draw) at or before that.
MAX_ROUNDS = 320


def _rollout(bridge_path, seed: int) -> dict[str, list]:
    env = WarwrightVectorEnv(
        NUM_ENVS, ticks_per_step=TICKS_PER_STEP, bridge_path=bridge_path
    )
    try:
        env.action_space.seed(seed)
        obs, info = env.reset(seed=seed)

        observations = [obs.copy()]
        replay_seeds = [info["replay_seed"].copy()]
        terminations: list[np.ndarray] = []
        winners: list[list] = []
        hashes: list[list] = []

        done = np.zeros(NUM_ENVS, dtype=bool)
        for _ in range(MAX_ROUNDS):
            if done.all():
                break
            actions = env.action_space.sample()
            obs, rewards, terminated, truncated, info = env.step(actions)

            assert not truncated.any(), "WarwrightVectorEnv must never truncate"
            assert (rewards == 0.0).all(), "reward is always 0.0 in #64 (see #65)"

            observations.append(obs.copy())
            replay_seeds.append(info["replay_seed"].copy())
            terminations.append(terminated.copy())
            winners.append(list(info["winner"]))
            hashes.append(list(info["hash"]))

            done = done | terminated

        assert done.all(), "every sub-env must reach done within MAX_ROUNDS"

        return {
            "observations": observations,
            "replay_seeds": replay_seeds,
            "terminations": terminations,
            "winners": winners,
            "hashes": hashes,
        }
    finally:
        env.close()


def test_vectorized_random_policy_rollout_reaches_done_for_every_sub_env(bridge_path):
    trajectory = _rollout(bridge_path, seed=21)

    final_winners = [
        winner
        for step_winners in trajectory["winners"]
        for winner in step_winners
        if winner is not None
    ]
    assert len(final_winners) == NUM_ENVS
    for winner in final_winners:
        assert winner in ("A", "B", "draw")


def test_gym_rollout_is_deterministic_given_the_same_seed(bridge_path):
    first = _rollout(bridge_path, seed=17)
    second = _rollout(bridge_path, seed=17)

    assert len(first["observations"]) == len(second["observations"])
    for obs_a, obs_b in zip(first["observations"], second["observations"], strict=True):
        assert np.array_equal(obs_a, obs_b)

    assert len(first["terminations"]) == len(second["terminations"])
    for term_a, term_b in zip(first["terminations"], second["terminations"], strict=True):
        assert np.array_equal(term_a, term_b)

    assert first["winners"] == second["winners"]
    assert first["hashes"] == second["hashes"]
    for seeds_a, seeds_b in zip(first["replay_seeds"], second["replay_seeds"], strict=True):
        assert np.array_equal(seeds_a, seeds_b)


def test_gym_rollout_differs_across_different_seeds(bridge_path):
    # Sanity guard against a determinism test that would trivially pass
    # because everything is constant regardless of seed.
    first = _rollout(bridge_path, seed=1)
    second = _rollout(bridge_path, seed=2)

    assert not np.array_equal(first["replay_seeds"][0], second["replay_seeds"][0])
