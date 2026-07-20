"""Policy export path for #131 (#66a, split from #66): converts a trained
`ActorCriticPolicy` (from a `smoke_run.py --save-checkpoint` state_dict, or
an already-committed weights JSON, for a fixture-only regen) into the two
artifacts #66b's future TypeScript float64 inference Behavior mirrors and
parity-tests against:

  - `policy-smoke-v1.weights.json`: the actor-only network weights (no
    critic head -- play time only ever needs the actor). Every float32
    weight/bias value is serialized via Python `float(w)` (float64 exactly
    represents any float32 value) so `JSON.parse` on the TypeScript side
    recovers it bit-exact -- see `test_export_policy.py`'s round-trip test.
  - `inference-parity.fixture.json`: a set of `(obs, action, minMargin)`
    cases #66b's TS parity test replays through its own inference and
    compares against. Observations come from deterministic-argmax rollouts
    of the COMMITTED policy over the pinned eval protocol
    (`warwright_gym.training.evaluate`'s `EVAL_SEED_BASE`/`EVAL_BATCH_SIZE`/
    `EVAL_NUM_BATCHES`), in-distribution for the smoke build pair
    (`smoke_run.py`'s `smoke_build_a`/`smoke_build_b`), plus a few
    hand-built edge cases. Near-tie cases (per-component top-2 logit
    margin under `MARGIN_EPSILON`) are dropped: a float32-torch-vs-float64-
    TS forward pass can differ by ~1e-4, and a near-tied argmax could flip
    under that -- see `filter_cases_by_margin`.

CI never trains: this module and the one recorded, committed export it
produced (`gym/EXPORT.md`) are the only path to `policy-smoke-v1`'s
weights. `test_inference_parity_fixture.py` is the SYNC test that keeps
the committed weights and fixture from silently drifting apart.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import torch

from warwright_gym.actions import OBS_ENCODING_VERSION, SKILL_CATALOG
from warwright_gym.featurize import featurize
from warwright_gym.observation import (
    OBS_SELF_FIELD_COUNT,
    OBS_SELF_HP_INDEX,
    OBS_SELF_SKILL_COOLDOWN_START_INDEX,
    OBS_UNIT_FIELD_COUNT,
    OBS_UNIT_HP_OFFSET,
    OBS_UNIT_MAX_HP_OFFSET,
    compute_observation_length,
)
from warwright_gym.training.policy import ActorCriticPolicy

# Kept re-exported here (rather than requiring every caller to import from
# warwright_gym.actions directly) since the weights/fixture JSON schemas
# both embed it as `obsEncodingVersion`.
__all__ = [
    "BEHAVIOR_ID",
    "EXPORT_FORMAT_VERSION",
    "MARGIN_EPSILON",
    "MIN_FIXTURE_CASES",
    "OBS_ENCODING_VERSION",
    "TARGET_FIXTURE_CASES",
    "assert_enough_cases",
    "build_fixture_case",
    "collect_pinned_rollout_observations",
    "compute_action_and_margins",
    "dedupe_observations",
    "filter_cases_by_margin",
    "generate_weights_and_fixture",
    "hand_built_edge_case_observations",
    "main",
    "policy_to_weights_json",
    "sha256_hex",
    "weights_json_to_policy",
]

EXPORT_FORMAT_VERSION = 1
BEHAVIOR_ID = "policy-smoke-v1"

# Per the #131 SUB_PLAN: "~1e-2 gives ~2 orders of magnitude over the
# expected ~1e-4 float32-vs-float64 forward divergence" between the torch
# float32 policy and a future float64 TS inference reimplementation.
MARGIN_EPSILON = 0.01

# Fail loud (generate_weights_and_fixture raises) if fewer than this many
# cases survive the near-tie filter -- the fixture is the parity contract
# #66b depends on, so a near-empty fixture must never be committed silently.
MIN_FIXTURE_CASES = 16

# "Deduped to ~64" per the SUB_PLAN: the rollout-derived case count is
# capped here, BEFORE the hand-built edge cases are appended and BEFORE the
# near-tie filter runs (so the final committed count is typically somewhat
# below this).
TARGET_FIXTURE_CASES = 64

_REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_WEIGHTS_OUT = (
    _REPO_ROOT / "packages/core/src/content/behaviors/policy/policy-smoke-v1.weights.json"
)
DEFAULT_FIXTURE_OUT = (
    _REPO_ROOT / "packages/core/src/content/behaviors/policy/inference-parity.fixture.json"
)


# --- Weights JSON ----------------------------------------------------------


def _matrix_to_list(weight: torch.Tensor) -> list[list[float]]:
    return [[float(value) for value in row] for row in weight.detach().numpy()]


def _vector_to_list(bias: torch.Tensor) -> list[float]:
    return [float(value) for value in bias.detach().numpy()]


def policy_to_weights_json(
    policy: ActorCriticPolicy,
    *,
    behavior_id: str = BEHAVIOR_ID,
    obs_encoding_version: int = OBS_ENCODING_VERSION,
) -> dict[str, Any]:
    """The actor-only committed weights JSON (no critic head) for `policy`.
    Every float is a plain Python `float` of the underlying float32 value
    (see this module's docstring) -- `json.dumps` on the result is what
    `test_export_policy.py` checks reloads bit-exact."""
    return {
        "formatVersion": EXPORT_FORMAT_VERSION,
        "behaviorId": behavior_id,
        "obsEncodingVersion": obs_encoding_version,
        "obsDim": policy.obs_dim,
        "nvec": list(policy.nvec),
        "hidden": [policy.trunk_layer_1.out_features, policy.trunk_layer_2.out_features],
        "trunk1": {
            "weight": _matrix_to_list(policy.trunk_layer_1.weight),
            "bias": _vector_to_list(policy.trunk_layer_1.bias),
        },
        "trunk2": {
            "weight": _matrix_to_list(policy.trunk_layer_2.weight),
            "bias": _vector_to_list(policy.trunk_layer_2.bias),
        },
        "actorHead": {
            "weight": _matrix_to_list(policy.actor_head.weight),
            "bias": _vector_to_list(policy.actor_head.bias),
        },
    }


def weights_json_to_policy(weights: dict[str, Any]) -> ActorCriticPolicy:
    """Reconstructs an `ActorCriticPolicy` from a committed weights JSON
    dict (the inverse of `policy_to_weights_json`, actor layers only -- the
    critic head is left at its random init, unused by any export
    consumer)."""
    obs_dim = int(weights["obsDim"])
    nvec = list(weights["nvec"])
    hidden_sizes = tuple(weights["hidden"])
    policy = ActorCriticPolicy(obs_dim=obs_dim, nvec=nvec, hidden_sizes=hidden_sizes)

    with torch.no_grad():
        for layer_name, layer_attr in (
            ("trunk1", "trunk_layer_1"),
            ("trunk2", "trunk_layer_2"),
            ("actorHead", "actor_head"),
        ):
            layer = getattr(policy, layer_attr)
            layer.weight.copy_(
                torch.tensor(weights[layer_name]["weight"], dtype=torch.float32)
            )
            layer.bias.copy_(torch.tensor(weights[layer_name]["bias"], dtype=torch.float32))

    return policy


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write_json_file(path: Path, data: dict[str, Any]) -> bytes:
    encoded = (json.dumps(data, indent=2) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded)
    return encoded


# --- Parity fixture cases ---------------------------------------------------


def compute_action_and_margins(
    policy: ActorCriticPolicy, obs_row: np.ndarray
) -> tuple[list[int], list[float]]:
    """The policy's deterministic-argmax action for a single raw int64
    observation row, alongside each component's top-2 logit margin
    (`float("inf")` for a component with only one possible value -- e.g.
    `target_slot` on a 1-enemy build, which can never be a near-tie)."""
    features = featurize(obs_row[np.newaxis, :])
    with torch.no_grad():
        per_component_logits = policy.actor_logits(torch.as_tensor(features, dtype=torch.float32))

    action: list[int] = []
    margins: list[float] = []
    for logits in per_component_logits:
        row = logits[0]
        if row.shape[-1] < 2:
            action.append(int(torch.argmax(row).item()))
            margins.append(float("inf"))
            continue
        values, indices = torch.topk(row, k=2)
        action.append(int(indices[0].item()))
        margins.append(float((values[0] - values[1]).item()))
    return action, margins


def build_fixture_case(policy: ActorCriticPolicy, obs_row: np.ndarray) -> dict[str, Any]:
    action, margins = compute_action_and_margins(policy, obs_row)
    finite_margins = [margin for margin in margins if math.isfinite(margin)]
    min_margin = min(finite_margins) if finite_margins else float("inf")
    return {
        "obs": [int(value) for value in obs_row.tolist()],
        "action": action,
        "minMargin": float(min_margin),
    }


def filter_cases_by_margin(
    cases: list[dict[str, Any]], margin_epsilon: float = MARGIN_EPSILON
) -> list[dict[str, Any]]:
    """Drops every case whose `minMargin` is strictly below `margin_epsilon`
    -- a case AT the threshold is kept (see the SUB_PLAN's "DROP cases with
    min margin < 0.01")."""
    return [case for case in cases if case["minMargin"] >= margin_epsilon]


def assert_enough_cases(cases: list[dict[str, Any]], minimum: int = MIN_FIXTURE_CASES) -> None:
    if len(cases) < minimum:
        raise RuntimeError(
            f"assert_enough_cases: only {len(cases)} parity fixture case(s) survived the "
            f"near-tie margin filter, fewer than the required minimum of {minimum}. The "
            "fixture is the parity contract #66b's TS inference test depends on -- widen "
            "the observation sample, or investigate whether the policy is unexpectedly "
            "near-uniform, before committing a near-empty fixture."
        )


def dedupe_observations(observations: list[np.ndarray]) -> list[np.ndarray]:
    """Drops exact-duplicate observation rows, preserving first-seen
    order."""
    seen: set[tuple[int, ...]] = set()
    deduped: list[np.ndarray] = []
    for obs in observations:
        key = tuple(int(value) for value in obs.tolist())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(np.asarray(key, dtype=obs.dtype))
    return deduped


def hand_built_edge_case_observations(
    template: np.ndarray, *, enemy_slot: int = 0
) -> list[np.ndarray]:
    """A handful of synthetic variants of a real observation `template`,
    covering scenarios a pinned-seed rollout may visit only rarely (or
    never, e.g. a fixture-relevant boundary state right at a kill): the
    agent's only equipped skill ("cleave") ready vs. on cooldown, the
    target enemy near death vs. at full hp, and the agent itself near
    death. Every variant still carries the template's `-1`
    absent-skill cooldown sentinels for every OTHER catalog skill
    unchanged (`warwright_gym.observation.SKILL_COOLDOWN_ABSENT`) -- the
    smoke build's agent equips only "cleave", so those sentinels are
    already present in every real observation this function mutates."""
    cleave_slot = OBS_SELF_SKILL_COOLDOWN_START_INDEX + SKILL_CATALOG.index("cleave")
    enemy_hp_index = OBS_SELF_FIELD_COUNT + enemy_slot * OBS_UNIT_FIELD_COUNT + OBS_UNIT_HP_OFFSET
    enemy_max_hp_index = (
        OBS_SELF_FIELD_COUNT + enemy_slot * OBS_UNIT_FIELD_COUNT + OBS_UNIT_MAX_HP_OFFSET
    )

    variants: list[np.ndarray] = []

    skill_ready = template.copy()
    skill_ready[cleave_slot] = 0
    variants.append(skill_ready)

    skill_on_cooldown = template.copy()
    skill_on_cooldown[cleave_slot] = 999
    variants.append(skill_on_cooldown)

    enemy_near_death = template.copy()
    enemy_near_death[enemy_hp_index] = 1
    variants.append(enemy_near_death)

    enemy_full_hp = template.copy()
    enemy_full_hp[enemy_hp_index] = int(template[enemy_max_hp_index])
    variants.append(enemy_full_hp)

    self_near_death = template.copy()
    self_near_death[OBS_SELF_HP_INDEX] = 1
    variants.append(self_near_death)

    return variants


def collect_pinned_rollout_observations(
    policy: ActorCriticPolicy,
    *,
    build_a: dict[str, Any],
    build_b: dict[str, Any],
    ticks_per_step: int = 20,
    node: str = "node",
    bridge_path: Path | None = None,
) -> list[np.ndarray]:
    """Every raw int64 observation the deterministic-argmax `policy` acted
    on over the FULL pinned eval protocol
    (`warwright_gym.training.evaluate`'s `EVAL_SEED_BASE`/`EVAL_BATCH_SIZE`/
    `EVAL_NUM_BATCHES`) against `build_a`/`build_b` -- in-distribution
    states for the committed policy, per the #131 SUB_PLAN. Mirrors
    `evaluate()`'s loop exactly, but records observations instead of
    winners."""
    from warwright_gym.env import WarwrightVectorEnv
    from warwright_gym.training.evaluate import (
        EVAL_BATCH_SIZE,
        EVAL_NUM_BATCHES,
        EVAL_SEED_BASE,
        MAX_EVAL_STEPS,
        TorchPolicyAdapter,
    )

    adapter = TorchPolicyAdapter(policy)
    env = WarwrightVectorEnv(
        EVAL_BATCH_SIZE,
        build_a=build_a,
        build_b=build_b,
        ticks_per_step=ticks_per_step,
        bridge_path=bridge_path,
        node=node,
    )
    observations: list[np.ndarray] = []
    try:
        for batch_index in range(EVAL_NUM_BATCHES):
            obs, _info = env.reset(seed=EVAL_SEED_BASE + batch_index)
            done = np.zeros(env.num_envs, dtype=bool)

            for _step in range(MAX_EVAL_STEPS):
                if done.all():
                    break
                for env_id in range(env.num_envs):
                    if not done[env_id]:
                        observations.append(obs[env_id].copy())
                actions = adapter.act(obs)
                obs, _rewards, terminated, truncated, _info = env.step(actions)
                if bool(np.asarray(truncated).any()):
                    raise RuntimeError(
                        "collect_pinned_rollout_observations: WarwrightVectorEnv must never "
                        "truncate"
                    )
                done = done | terminated

            if not done.all():
                raise RuntimeError(
                    f"collect_pinned_rollout_observations: batch {batch_index} did not reach "
                    f"done for every sub-env within MAX_EVAL_STEPS={MAX_EVAL_STEPS}"
                )
    finally:
        env.close()
    return observations


def generate_weights_and_fixture(
    *,
    checkpoint_path: Path | None = None,
    weights_json_path: Path | None = None,
    weights_out: Path = DEFAULT_WEIGHTS_OUT,
    fixture_out: Path = DEFAULT_FIXTURE_OUT,
    node: str = "node",
    bridge_path: Path | None = None,
) -> dict[str, Any]:
    """Top-level orchestration: exactly one of `checkpoint_path` (a
    `smoke_run.py --save-checkpoint` state_dict, the normal path) or
    `weights_json_path` (an already-committed weights JSON, for a
    fixture-only regen with unchanged weights) must be given. Writes both
    committed artifacts and returns a small summary dict (candidate/
    surviving case counts) for the CLI to print / `gym/EXPORT.md` to
    record."""
    if (checkpoint_path is None) == (weights_json_path is None):
        raise ValueError(
            "generate_weights_and_fixture: exactly one of checkpoint_path or "
            "weights_json_path must be given"
        )

    # Local import: smoke_run.py's build pair is this export's fixed
    # target (policy-smoke-v1 is trained -- and its fixture generated --
    # against that exact 1v1 matchup only).
    from warwright_gym.training.smoke_run import smoke_build_a, smoke_build_b

    build_a = smoke_build_a()
    build_b = smoke_build_b()
    num_allies = len(build_a["units"]) - 1
    num_enemies = len(build_b["units"])
    obs_dim = compute_observation_length(num_allies, num_enemies)
    nvec = [5, num_allies + num_enemies, 6, 1001, 1001]

    if checkpoint_path is not None:
        policy = ActorCriticPolicy(obs_dim=obs_dim, nvec=nvec)
        state_dict = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
        policy.load_state_dict(state_dict)
        weights = policy_to_weights_json(policy)
        weights_bytes = _write_json_file(weights_out, weights)
    else:
        assert weights_json_path is not None
        weights_bytes = weights_json_path.read_bytes()
        weights = json.loads(weights_bytes)
        policy = weights_json_to_policy(weights)
        if weights_json_path.resolve() != weights_out.resolve():
            weights_bytes = _write_json_file(weights_out, weights)

    weights_sha = sha256_hex(weights_bytes)

    rollout_observations = collect_pinned_rollout_observations(
        policy, build_a=build_a, build_b=build_b, node=node, bridge_path=bridge_path
    )
    deduped_rollout_observations = dedupe_observations(rollout_observations)[
        :TARGET_FIXTURE_CASES
    ]
    edge_case_observations = hand_built_edge_case_observations(deduped_rollout_observations[0])
    all_observations = deduped_rollout_observations + edge_case_observations

    candidate_cases = [build_fixture_case(policy, obs) for obs in all_observations]
    surviving_cases = filter_cases_by_margin(candidate_cases, MARGIN_EPSILON)
    assert_enough_cases(surviving_cases, MIN_FIXTURE_CASES)

    fixture = {
        "formatVersion": EXPORT_FORMAT_VERSION,
        "obsEncodingVersion": OBS_ENCODING_VERSION,
        "behaviorId": weights["behaviorId"],
        "weightsSha256": weights_sha,
        "marginEpsilon": MARGIN_EPSILON,
        "cases": surviving_cases,
    }
    _write_json_file(fixture_out, fixture)

    return {
        "numCandidateCases": len(candidate_cases),
        "numSurvivingCases": len(surviving_cases),
        "weightsSha256": weights_sha,
        "weightsOut": str(weights_out),
        "fixtureOut": str(fixture_out),
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--checkpoint", type=Path, default=None)
    source.add_argument(
        "--weights-json",
        type=Path,
        default=None,
        help="Regenerate the fixture only, from an already-committed weights JSON.",
    )
    parser.add_argument("--weights-out", type=Path, default=DEFAULT_WEIGHTS_OUT)
    parser.add_argument("--fixture-out", type=Path, default=DEFAULT_FIXTURE_OUT)
    parser.add_argument("--node", default="node")
    parser.add_argument("--bridge-path", type=Path, default=None)
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    summary = generate_weights_and_fixture(
        checkpoint_path=args.checkpoint,
        weights_json_path=args.weights_json,
        weights_out=args.weights_out,
        fixture_out=args.fixture_out,
        node=args.node,
        bridge_path=args.bridge_path,
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
