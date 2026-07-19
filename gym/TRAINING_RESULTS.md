# #65 smoke training run results

The training modules (`warwright_gym.training.*`) depend on torch, which
lives in the optional `train` dependency group (`gym/pyproject.toml`) --
NOT installed by a plain `uv sync`/`uv run`, so a fresh clone must opt in
explicitly:

```bash
uv sync --directory gym --group train
uv run --directory gym --group train pytest        # includes the training tests
uv run --directory gym --group train ruff check .
```

(Without `--group train`, `uv run --directory gym pytest` still runs
cleanly -- the training test modules `pytest.importorskip("torch")` and
SKIP rather than error. CI always installs the `train` group, so it is
unaffected either way.)

Recorded from `uv run --directory gym --group train python -m warwright_gym.training.smoke_run --seed 1`,
run on the commit below (same box, single CPU thread, `torch.use_deterministic_algorithms(True)`
per `warwright_gym.training.ppo.seed_everything`).

```
git rev:      0546132e2637cc2a0a68a37134687a0355c49088
seed:         1
N (matches):  64 (4 pinned-seed batches of 16, EVAL_SEED_BASE=1_000_000; see
              warwright_gym.training.evaluate's module docstring)
```

## Build pair (a bounded-iteration substitution -- see below)

`warwright_gym.training.smoke_run.smoke_build_a` / `smoke_build_b`: the
same lone external reaver `warwright_gym.env.default_build_a` uses, vs. a
**single** `warden` (`aggro-lowest-hp` Behavior) -- **not**
`warwright_gym.env`'s default 2-enemy `build_b` (a mender + a warden).
`env.py`'s `default_build_a`/`default_build_b` are unchanged; every other
gym test still uses them.

## Winnability pre-check

The scripted `HeuristicPolicy` (move-toward/attack the lowest-hp alive
enemy, action choice only, reading hp/distance straight off the raw
observation) was evaluated on **both** pairs, over the full pinned N=64:

| Build pair | Heuristic win rate |
|---|---|
| `env.py` default (1 reaver vs. mender+warden) | 64/64 = 100% |
| smoke_run's 1v1 (1 reaver vs. warden) | 64/64 = 100% |

Both pairs **are winnable** -- the default pair was not discarded because
it was unfair or unwinnable (see the next section for why it was still
replaced for the actual PPO run).

## Why the build pair was changed (bounded iteration, SUB_PLAN order)

The first several training attempts used `env.py`'s default 2-enemy pair
and produced **no improvement** (before = after = 0.0 win rate) across:

- 4 different seeds (1, 2, 3, 4) at the smoke budget (50k timesteps),
- `damage_dealt_weight` swept from 0.5 (default) up to 4.0, with
  `ally_hp_weight` disabled,
- `total_timesteps` raised to 200,000 (the SUB_PLAN's ceiling).

None of that moved the needle, so before falling back to a build-pair
change (bounded iteration step 3), the trained policy was traced action-by-
action against a fixed observation. The finding: the policy reliably
learns to `attack` (the `kind` component's argmax correctly shifts from an
initial "wander off to a random coordinate" to "attack" after training),
and does kill the weaker of the two enemies -- but its `target_slot` head
**never learns to re-target the survivor**. Feeding the trained policy two
hand-built observations that differ ONLY in whether the first enemy is
alive or dead produced near-identical `target_slot` logits
(`[-0.2026, 0.2009]` alive vs. `[-0.2025, 0.2008]` dead), i.e. the network
never learned to use that signal at all.

The likely mechanism: `target_slot` is a 2-way decision that shares the
trunk with `move_x`/`move_y`, two 1001-way decisions. PPO's per-sample
loss sums log-prob (and entropy) across all five `MultiDiscrete`
components; `move_x`/`move_y`'s much larger per-component scale
(`log(1001) ≈ 6.9` nats vs. `target_slot`'s `log(2) ≈ 0.69` nats)
dominates the trunk's gradient at this smoke-level budget, effectively
starving `target_slot` of a usable learning signal. This is a real
limitation of the flat, unweighted `MultiDiscrete` decomposition this
policy architecture uses (`policy.py`'s docstring notes the architecture
is fixed by the #65 SUB_PLAN for #66 export-friendliness) -- not a bug in
the PPO loop or the masking logic (both are unit- and bridge-tested
independently of this).

Per the SUB_PLAN: *"bounded iteration knobs IN ORDER: (1) shaping
weights, (2) total timesteps (≤200k), (3) the build pair."* Steps 1 and 2
were exhausted first (see above) with zero effect; step 3 -- a 1-enemy
build pair, which has **no `target_slot` decision to make at all**
(`T = 1`) -- sidesteps the identified obstacle directly while remaining a
genuine, winnable fight (not a walkover: see the heuristic table above).

## Result

| | Win rate | Wins | Losses | Draws |
|---|---|---|---|---|
| Before (random init) | 0.0% | 0 | 64 | 0 |
| After (50,000 timesteps) | 100.0% | 64 | 0 | 0 |

**Delta: +100.0 percentage points** (N=64), well above the SUB_PLAN's
≥+15pp target.

## Full config

```json
{
  "num_envs": 8,
  "ticks_per_step": 20,
  "num_steps": 128,
  "total_timesteps": 50000,
  "learning_rate": 0.0003,
  "gamma": 0.99,
  "gae_lambda": 0.95,
  "clip_coef": 0.2,
  "ent_coef": 0.01,
  "vf_coef": 0.5,
  "max_grad_norm": 0.5,
  "update_epochs": 4,
  "num_minibatches": 4,
  "seed": 1,
  "reward_config": {
    "win_reward": 1.0,
    "loss_reward": -1.0,
    "draw_reward": 0.0,
    "damage_dealt_weight": 0.5,
    "ally_hp_weight": 0.1,
    "enable_terminal": true,
    "enable_damage_dealt": true,
    "enable_ally_hp": true
  }
}
```

Final update's loss diagnostics (policy_loss/value_loss/entropy finite,
`total_reward_sum` over the run's valid transitions):

```json
{
  "policy_loss": -0.04949804273201153,
  "value_loss": 0.004341897089034319,
  "entropy": 15.215500950813293,
  "num_valid_samples": 896,
  "mean_value_estimate": 1.1850121021270752,
  "total_reward_sum": 6436.947627067566
}
```

Wall-clock: ~8s for the full eval-train-eval loop on the box this was run
on (Apple Silicon, CPU-only torch, single thread per
`seed_everything`'s `torch.set_num_threads(1)`).

## Reproducibility

`gym/tests/test_ppo_smoke.py::test_train_is_reproducible_same_seed_same_box`
and `::test_evaluate_is_reproducible_across_two_runs` pin this at a tiny
budget in CI. Re-running the exact command above on the same box
(`git rev` `0546132e2637cc2a0a68a37134687a0355c49088`) reproduced
identical before/after win rates and loss diagnostics. Per
`warwright_gym.training.ppo.seed_everything`'s docstring, this
reproducibility guarantee is **same-box only**: cross-machine bitwise
equality is not promised (different BLAS/CPU builds can round
differently).

## The known limitation this run does NOT fix

The 2-enemy `target_slot` re-targeting gap documented above is real and
unresolved for that harder matchup -- this run's positive result is on
the simpler 1v1 pair specifically because that gap made the 2-enemy pair
an unproductive target for a smoke-level budget, not because the gap was
fixed. A follow-up (out of scope for #65) could weight/normalize the
`MultiDiscrete` components' contribution to the PPO loss (e.g. per-
component entropy/log-prob normalization) so a small-cardinality head like
`target_slot` is not drowned out by the two large `move_x`/`move_y` heads.
