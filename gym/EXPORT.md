# `policy-smoke-v1` export record (#131 / #66a)

The committed artifacts at
`packages/core/src/content/behaviors/policy/policy-smoke-v1.weights.json`
and `packages/core/src/content/behaviors/policy/inference-parity.fixture.json`
came from ONE manual, recorded run of `smoke_run.py` (#65's smoke config
and 1v1 build pair) followed by `export_policy.py`. CI never retrains or
regenerates these files -- it only consumes them
(`gym/tests/test_inference_parity_fixture.py` is the sync test that keeps
them from drifting apart from each other).

## Commands

Run from the repo root, same box, single CPU thread
(`warwright_gym.training.ppo.seed_everything`, per `gym/TRAINING_RESULTS.md`):

```bash
uv run --directory gym --group train python -m warwright_gym.training.smoke_run \
  --seed 0 \
  --save-checkpoint /path/to/policy-smoke-v1.checkpoint.pt

uv run --directory gym --group train python -m warwright_gym.training.export_policy \
  --checkpoint /path/to/policy-smoke-v1.checkpoint.pt
```

(`export_policy.py`'s `--weights-out`/`--fixture-out` default to the
committed paths above; `--checkpoint` is NOT itself committed -- only the
two JSON artifacts it produces are.)

```
git rev (smoke_run):    9db639646f5819e87b807475547103ab27b78b36
seed:                   0
config:                 PPOConfig() defaults (num_envs=8, num_steps=128,
                         total_timesteps=50_000, RewardConfig() defaults)
build pair:              smoke_run.py's smoke_build_a/smoke_build_b (#65's
                         1v1 substitution: a lone external reaver vs. a
                         single warden -- see smoke_run.py's module
                         docstring)
```

## Training result (before -> after, N=64 pinned matches)

| | Win rate | Wins | Losses | Draws |
|---|---|---|---|---|
| Before (random init) | 0.0% | 0 | 64 | 0 |
| After (trained) | 100.0% | 64 | 0 | 0 |

The exported policy plays the smoke matchup well (not the 0.0% -> 0.0%
failure mode #65's default 2-enemy build pair hit -- see
`gym/TRAINING_RESULTS.md`), matching the SUB_PLAN's "the committed weights
must be from a policy that actually plays reasonably" requirement.

## Committed weights

```
policy-smoke-v1.weights.json sha256: bc9413408909a38375828a0b47b6864fbba1de879a1f33e2ef359e297a3509aa
```

Actor only (`trunk1`/`trunk2`/`actorHead`; the critic head is dropped --
play time never needs it). `obsDim = 17`, `nvec = [5, 1, 6, 1001, 1001]`,
`hidden = [64, 64]`.

## Parity fixture: the near-tie filter finding

The SUB_PLAN's "~64" case target assumed a pinned-seed rollout of the
committed policy over `evaluate.py`'s protocol (4 batches x 16 envs = 64
matches, `ticks_per_step=20`) would surface roughly that many DISTINCT
observations. In practice, at `ticks_per_step=20` it did not: this
specific matchup consumes RNG in a way that never diverges the
trajectory (fixed starting positions, deterministic-argmax policy, no
damage-roll variance the two roles in this build actually hit), so
literally EVERY one of the 64 pinned matches plays out identically --
confirmed by sweeping far beyond the pinned protocol's seed range (20
batches instead of 4) and still deduplicating down to the same 7 unique
observations.

Rather than accept a 7-observation fixture (`assert_enough_cases` fails
loud below `MIN_FIXTURE_CASES = 16` for exactly this reason -- the first
export attempt hit it), `export_policy.py`'s fixture-observation
collection uses a finer `ticks_per_step=1` (`FIXTURE_TICKS_PER_STEP`,
distinct from `evaluate()`'s own `ticks_per_step=20` win-rate protocol,
which is unchanged) to sample the SAME real, in-distribution fight at a
1-tick grain instead. That surfaced 121 unique observations from the
pinned seed range; capped to the `TARGET_FIXTURE_CASES = 64` target,
plus 5 hand-built edge cases (the agent's only equipped skill, "cleave",
ready vs. on cooldown; the enemy near death vs. at full hp; the agent
itself near death) = 69 candidates before dedup.

Two of those 5 edge variants turned out to be NO-OP mutations of their
template observation (the template's "cleave" cooldown was already 0, so
the "skill ready" variant reproduced it exactly; the template's enemy was
already at full hp, so the "enemy full hp" variant reproduced it exactly),
so `generate_weights_and_fixture` re-dedupes the combined 64-rollout +
5-edge observation list (`dedupe_observations`, exact-duplicate rows,
first-seen order preserved) before building fixture cases -- 69 candidate
observations, 2 exact duplicates dropped, **67 distinct candidates**.

All 67 candidates survived the `MARGIN_EPSILON = 0.01` near-tie filter
(`target_slot` is always `inf`-margin on this 1-enemy build -- a single
valid value, never a near-tie by construction; `minMargin` across the
other four components ranged `[0.0156, 0.0783]`, comfortably above the
0.01 threshold in every case).

```
formatVersion:     1
obsEncodingVersion: 1
behaviorId:        policy-smoke-v1
marginEpsilon:     0.01
numCandidateCases: 67
numSurvivingCases: 67
```

## TS mirror contract (#66b)

The committed weights JSON and `inference-parity.fixture.json` are the
parity contract for #66b's future pure-TypeScript float64 inference
Behavior. That Behavior must reproduce this exact forward pipeline, in
this exact order, for every fixture case's `obs` to reproduce its
committed `action`:

1. **Raw int observation → featurize**: divide each field by its
   field-class divisor (`HP_DIVISOR = 1024`, `POS_DIVISOR = 1024`,
   `COOLDOWN_DIVISOR = 64`, `DISTANCE_SQUARED_DIVISOR = 2**21`, unit id
   unscaled) -- EXCEPT a `-1` (`SKILL_COOLDOWN_ABSENT`) cooldown value,
   which passes through UNCHANGED, never divided. Every divisor is a
   power of two so the division is exact in binary floating point. See
   `featurize.py`'s `_DIVISORS` map and module docstring for the
   authoritative per-index field-class assignment (source of truth --
   never hardcode a parallel layout).
2. **trunk1**: `Linear` over the featurized vector, weight layout
   `[out][in]` (torch convention: `weight[i]` is output unit `i`'s
   incoming-weight row), `y = W·x + b`.
3. **tanh** elementwise over trunk1's output.
4. **trunk2**: `Linear` (same `[out][in]`/`y = W·x + b` layout) over
   trunk1's tanh output.
5. **tanh** elementwise over trunk2's output.
6. **actorHead**: `Linear` (same layout) over trunk2's tanh output,
   producing one flat logits vector of length `sum(nvec)`.
7. **Split** the flat logits vector into one segment per `nvec` entry, in
   `nvec` order (`[kind, targetSlot, skillIndex, moveX, moveY]` for this
   build).
8. **Per-component argmax**: the action for each component is the index
   of its segment's maximum logit. On an exact tie, the LOWEST index
   wins (this only matters for near-ties in principle -- the fixture's
   `minMargin` filter excludes every case where an argmax is within
   `marginEpsilon` of flipping, so no committed case actually exercises
   tie-breaking; a correct implementation still must not raise or pick
   the wrong side on one).

`policy.py` (`ActorCriticPolicy._trunk`/`actor_logits`) is the source of
truth for the op order (steps 2-7); `featurize.py` is the source of truth
for the divisor map and the absent-cooldown passthrough (step 1). No
running-statistics normalization, no non-power-of-two divisor, and no
step reordering -- any of those would silently break bit-for-bit parity
with the fixture without necessarily breaking `assert_enough_cases` or
any other loud signal.

## `packages/core` unaffected

Confirmed no `.ts` file changed and `packages/core/src/sim/__snapshots__/golden.json` /
`RULESET_VERSION` (`packages/core/src/sim/constants.ts`) are untouched;
`pnpm --filter @warwright/core test` passes (223/223) with only the two
new JSON data files present under `packages/core/src/content/behaviors/policy/`
(not referenced by any `.ts` module yet -- #66b wires that up).

## Fixture-only regen (PR #132 review round: duplicate-case dedup)

A follow-up regen re-ran `export_policy.py`'s `--weights-json` path
(fixture-only; the committed weights JSON bytes are UNCHANGED --
`weightsSha256` still `bc9413...`) after fixing the duplicate-observation
bug described above (the combined rollout+edge observation list is now
deduped before building fixture cases):

```bash
uv run --directory gym --group train python -m warwright_gym.training.export_policy \
  --weights-json packages/core/src/content/behaviors/policy/policy-smoke-v1.weights.json
```

This also exercises the regen-path guard `generate_weights_and_fixture`
now runs first on the `--weights-json` path: it fails loud if the
weights JSON's `obsEncodingVersion` doesn't match the running
`warwright_gym.actions.OBS_ENCODING_VERSION`, so regenerating fixture
observations under a bumped encoding against old-encoding weights can
never silently produce a mismatched artifact.
