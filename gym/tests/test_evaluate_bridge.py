"""Bridge-backed integration test for warwright_gym.training.evaluate
(#65): the winnability pre-check the #65 SUB_PLAN requires before burning
any training compute -- the scripted `HeuristicPolicy` must be able to WIN
the default `build_a`/`build_b` pair (see `smoke_run.py`'s manual, full
N=64 run for the number actually recorded in TRAINING_RESULTS.md; this
test uses a single batch to stay CI-fast while still catching a
regression that makes the default matchup unwinnable).
"""

from __future__ import annotations

import pytest

pytest.importorskip("torch")

from warwright_gym.env import WarwrightVectorEnv, default_build_a, default_build_b
from warwright_gym.training.evaluate import EVAL_SEED_BASE, HeuristicPolicy, evaluate

TICKS_PER_STEP = 20
_NUM_ALLIES = len(default_build_a()["units"]) - 1
_NUM_ENEMIES = len(default_build_b()["units"])


def test_heuristic_policy_can_win_the_default_build_pair(bridge_path):
    env = WarwrightVectorEnv(16, ticks_per_step=TICKS_PER_STEP, bridge_path=bridge_path)
    try:
        policy = HeuristicPolicy(num_allies=_NUM_ALLIES, num_enemies=_NUM_ENEMIES)
        result = evaluate(env, policy, num_batches=1, seed_base=EVAL_SEED_BASE)

        assert result.wins > 0, (
            "the default build_a/build_b pair is unwinnable even for the scripted "
            "heuristic baseline -- per the #65 SUB_PLAN, smoke_run.py must switch "
            "to a fairer fixed build pair"
        )
    finally:
        env.close()
