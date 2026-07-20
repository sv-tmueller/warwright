"""Manual smoke training run for #65: `eval(initial random policy)` ->
`train()` -> `eval(final policy)`, printed as a JSON report `{git rev,
seed, full config incl. RewardConfig, before/after win rate, delta, N}`.

NOT run by CI (the #65 SUB_PLAN reserves the measurable-improvement run for
a manual, recorded execution -- see `gym/TRAINING_RESULTS.md`). Requires the
optional `train` dependency group (`uv sync --directory gym --group train`
-- see `gym/TRAINING_RESULTS.md`). Invoke directly:

    uv run --directory gym --group train python -m warwright_gym.training.smoke_run

## Build pair: a bounded-iteration substitution (SUB_PLAN step 3)

The winnability pre-check on `warwright_gym.env`'s DEFAULT pair (a lone
external reaver vs. a mender+warden baseline, 2 enemies) confirmed it IS
winnable -- the scripted `HeuristicPolicy` wins 64/64 pinned-seed matches
(`gym/tests/test_evaluate_bridge.py`). But the actual PPO agent
consistently failed to learn on it (0.0 -> 0.0 win rate across several
seeds, reward-shaping weights, and up to 200k timesteps): tracing a
trained policy showed it reliably learns to `attack` and kills the
weaker of the two enemies, but its `target_slot` head never learns to
RE-TARGET the survivor afterward (its logits for "which enemy" are
essentially identical whether the first enemy is alive or dead) --
`target_slot` is a 2-way decision sharing a trunk with the two 1001-way
`move_x`/`move_y` heads, whose vastly larger log-prob/entropy scale
dominates the summed multi-component PPO loss the shared trunk is
trained against, starving the small `target_slot` head of usable
gradient signal at this smoke-level budget. Per the SUB_PLAN's bounded
iteration order, (1) reward-shaping weights (`damage_dealt_weight` up to
4x, `ally_hp_weight` disabled) and (2) total timesteps (up to 200k) were
tried first and made no difference (still 0.0 -> 0.0) -- so this module
uses (3) a fairer, SIMPLER build pair: the same lone external reaver vs a
SINGLE warden. A 1-enemy roster has no `target_slot` decision to make
(`T = 1`), which sidesteps the identified obstacle entirely while
remaining a genuine fight (heuristic also wins 64/64 here, see
TRAINING_RESULTS.md) rather than a trivial one. `warwright_gym.env`'s
`default_build_a`/`default_build_b` (and every other test that uses them)
are UNCHANGED -- this substitution is local to this script's own build
pair, per the SUB_PLAN's "the training script takes build_a/build_b
params."
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import subprocess
from pathlib import Path
from typing import Any

import torch

from warwright_gym.env import EXTERNAL_BEHAVIOR_ID, WarwrightVectorEnv
from warwright_gym.observation import compute_observation_length
from warwright_gym.rewards import RewardConfig, RewardShapingWrapper
from warwright_gym.training.evaluate import (
    EVAL_BATCH_SIZE,
    EVAL_NUM_BATCHES,
    EVAL_SEED_BASE,
    EvalResult,
    TorchPolicyAdapter,
    evaluate,
)
from warwright_gym.training.policy import ActorCriticPolicy
from warwright_gym.training.ppo import PPOConfig, seed_everything, train


def smoke_build_a() -> dict[str, Any]:
    """A lone external unit: the trainable agent (team A). Deliberately
    the SAME roster `warwright_gym.env.default_build_a` uses -- only
    `smoke_build_b` differs (see the module docstring)."""
    return {
        "name": "Smoke Agent",
        "units": [
            {
                "roleId": "reaver",
                "skillIds": ["cleave"],
                "behaviorId": EXTERNAL_BEHAVIOR_ID,
                "position": {"x": 0, "y": 0},
            }
        ],
    }


def smoke_build_b() -> dict[str, Any]:
    """A SINGLE registered-Behavior enemy (team B) -- see the module
    docstring for why this run uses one enemy instead of
    `warwright_gym.env.default_build_b`'s two."""
    return {
        "name": "Smoke Baseline",
        "units": [
            {
                "roleId": "warden",
                "skillIds": [],
                "behaviorId": "aggro-lowest-hp",
                "position": {"x": 15, "y": 0},
            }
        ],
    }


def _git_rev() -> str:
    repo_root = Path(__file__).resolve().parents[3]
    try:
        return (
            subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo_root)  # noqa: S603, S607
            .decode()
            .strip()
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _eval_result_summary(result: EvalResult) -> dict[str, Any]:
    return {
        "win_rate": result.win_rate,
        "wins": result.wins,
        "losses": result.losses,
        "draws": result.draws,
        "num_matches": result.num_matches,
    }


def run_smoke(
    config: PPOConfig,
    *,
    node: str = "node",
    bridge_path: Path | None = None,
    save_checkpoint_path: Path | None = None,
) -> dict[str, Any]:
    """Runs the full eval-train-eval loop and returns the JSON-serializable
    report described in this module's docstring. Constructs three separate
    `WarwrightVectorEnv`s (before-eval, train, after-eval) so the
    before/after evaluations use a FRESH bridge subprocess each, matching
    how `evaluate()`'s pinned-seed protocol is meant to be called.

    If `save_checkpoint_path` is given, `torch.save`s the TRAINED policy's
    `state_dict` (actor + critic; #131's `export_policy.py` strips the
    critic for the committed weights artifact) there once training
    finishes, before the after-eval runs -- #65 left this step out
    entirely (this function only printed a report); #131 is the first
    caller that needs a persisted checkpoint to export from."""
    build_a = smoke_build_a()
    build_b = smoke_build_b()
    num_allies = len(build_a["units"]) - 1
    num_enemies = len(build_b["units"])
    nvec = [5, num_allies + num_enemies, 6, 1001, 1001]
    obs_dim = compute_observation_length(num_allies, num_enemies)

    seed_everything(config.seed)
    policy = ActorCriticPolicy(obs_dim=obs_dim, nvec=nvec)

    before_env = WarwrightVectorEnv(
        EVAL_BATCH_SIZE,
        build_a=build_a,
        build_b=build_b,
        ticks_per_step=config.ticks_per_step,
        bridge_path=bridge_path,
        node=node,
    )
    try:
        before = evaluate(
            before_env,
            TorchPolicyAdapter(policy),
            num_batches=EVAL_NUM_BATCHES,
            seed_base=EVAL_SEED_BASE,
        )
    finally:
        before_env.close()

    train_env = RewardShapingWrapper(
        WarwrightVectorEnv(
            config.num_envs,
            build_a=build_a,
            build_b=build_b,
            ticks_per_step=config.ticks_per_step,
            bridge_path=bridge_path,
            node=node,
        ),
        config.reward_config,
        num_allies=num_allies,
    )
    try:
        trained_policy, final_losses = train(train_env, config, policy)
    finally:
        train_env.close()

    if save_checkpoint_path is not None:
        save_checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        torch.save(trained_policy.state_dict(), save_checkpoint_path)

    after_env = WarwrightVectorEnv(
        EVAL_BATCH_SIZE,
        build_a=build_a,
        build_b=build_b,
        ticks_per_step=config.ticks_per_step,
        bridge_path=bridge_path,
        node=node,
    )
    try:
        after = evaluate(
            after_env,
            TorchPolicyAdapter(trained_policy),
            num_batches=EVAL_NUM_BATCHES,
            seed_base=EVAL_SEED_BASE,
        )
    finally:
        after_env.close()

    return {
        "git_rev": _git_rev(),
        "seed": config.seed,
        "config": dataclasses.asdict(config),
        "before": _eval_result_summary(before),
        "after": _eval_result_summary(after),
        "delta_pp": (after.win_rate - before.win_rate) * 100.0,
        "N": before.num_matches,
        "final_update_losses": final_losses,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=PPOConfig().seed)
    parser.add_argument("--total-timesteps", type=int, default=PPOConfig().total_timesteps)
    parser.add_argument("--num-envs", type=int, default=PPOConfig().num_envs)
    parser.add_argument("--num-steps", type=int, default=PPOConfig().num_steps)
    parser.add_argument("--ticks-per-step", type=int, default=PPOConfig().ticks_per_step)
    parser.add_argument(
        "--damage-dealt-weight", type=float, default=RewardConfig().damage_dealt_weight
    )
    parser.add_argument("--ally-hp-weight", type=float, default=RewardConfig().ally_hp_weight)
    parser.add_argument("--output-json", type=Path, default=None)
    parser.add_argument(
        "--save-checkpoint",
        type=Path,
        default=None,
        help=(
            "Path to torch.save the trained policy's state_dict to (#131's "
            "export_policy.py converts this into the committed weights JSON). "
            "Not written by default."
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    config = PPOConfig(
        num_envs=args.num_envs,
        ticks_per_step=args.ticks_per_step,
        num_steps=args.num_steps,
        total_timesteps=args.total_timesteps,
        seed=args.seed,
        reward_config=RewardConfig(
            damage_dealt_weight=args.damage_dealt_weight,
            ally_hp_weight=args.ally_hp_weight,
        ),
    )
    report = run_smoke(config, save_checkpoint_path=args.save_checkpoint)
    text = json.dumps(report, indent=2)
    print(text)
    if args.output_json is not None:
        args.output_json.write_text(text + "\n")


if __name__ == "__main__":
    main()
