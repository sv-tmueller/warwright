"""Bridge-backed integration test for warwright_gym.rewards (#127): wraps a
REAL `WarwrightVectorEnv` (built gym-bridge subprocess, real core) with
`RewardShapingWrapper` and runs a random policy to `done`, asserting the
terminal reward's sign matches `info["winner"]`. Every other reward-shaping
code path is covered by tests/test_rewards.py's pure-Python stub -- this is
the one test that proves the wrapper composes with the real env end to end.
"""

from __future__ import annotations

import numpy as np

from warwright_gym.env import WarwrightVectorEnv, default_build_a
from warwright_gym.rewards import RewardConfig, RewardShapingWrapper

TICKS_PER_STEP = 20
# 320 * 20 = 6400 ticks, at least the core's MATCH_TICK_CAP (6000): every
# sub-env reaches `done` (win, loss, or tick-cap draw) at or before that.
MAX_ROUNDS = 320
NUM_ENVS = 2


def test_terminal_reward_sign_matches_winner_over_a_real_bridge_rollout(bridge_path):
    # default_build_a is a lone external unit -> zero allies.
    num_allies = len(default_build_a()["units"]) - 1
    env = WarwrightVectorEnv(NUM_ENVS, ticks_per_step=TICKS_PER_STEP, bridge_path=bridge_path)
    wrapper = RewardShapingWrapper(env, RewardConfig(), num_allies=num_allies)
    try:
        wrapper.action_space.seed(11)
        wrapper.reset(seed=11)

        done = np.zeros(NUM_ENVS, dtype=bool)
        terminal_rewards: dict[int, float] = {}
        winners: dict[int, str] = {}
        for _ in range(MAX_ROUNDS):
            if done.all():
                break
            actions = wrapper.action_space.sample()
            obs, rewards, terminated, truncated, info = wrapper.step(actions)

            assert not truncated.any(), "WarwrightVectorEnv must never truncate"

            for env_id in range(NUM_ENVS):
                if terminated[env_id] and env_id not in terminal_rewards:
                    terminal_rewards[env_id] = float(rewards[env_id])
                    winners[env_id] = info["winner"][env_id]

            done = done | terminated

        assert done.all(), "every sub-env must reach done within MAX_ROUNDS"
        assert len(terminal_rewards) == NUM_ENVS

        config = RewardConfig()
        for env_id in range(NUM_ENVS):
            winner = winners[env_id]
            reward = terminal_rewards[env_id]
            if winner == "A":
                assert reward > 0.0, f"env {env_id}: winner A must have a positive reward"
            elif winner == "B":
                assert reward < 0.0, f"env {env_id}: winner B must have a negative reward"
            else:
                assert winner == "draw"
                # A draw's terminal component is 0.0, but any residual
                # shaping term on that final tick can still tilt the sign,
                # so only the terminal-only magnitude is asserted here.
                assert abs(reward) < config.win_reward
    finally:
        wrapper.close()
