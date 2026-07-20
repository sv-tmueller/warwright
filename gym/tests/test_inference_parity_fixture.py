"""SYNC test for #131 (#66a): mirrors gym/tests/test_protocol_golden.py's
discipline, direction reversed -- Python GENERATES the committed
`policy-smoke-v1.weights.json` / `inference-parity.fixture.json` artifacts
(via `warwright_gym.training.export_policy`, see `gym/EXPORT.md` for the
one recorded run that produced them), and #66b's future TypeScript
inference Behavior CONSUMES them. This test keeps the two committed
artifacts from silently drifting apart from each other or from the
weights file's own sha256: a stale fixture (regenerated weights without
regenerating the fixture, or vice versa, or a hand-edited weights file)
goes RED here, not silently.

No bridge/env needed: every fixture case already carries its own `obs`,
so re-deriving the expected action/margins is a pure forward pass over
the COMMITTED weights.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("torch")

import torch

from warwright_gym.training.export_policy import (
    MIN_FIXTURE_CASES,
    compute_action_and_margins,
    weights_json_to_policy,
)

_ARTIFACT_DIR = (
    Path(__file__).resolve().parents[2] / "packages/core/src/content/behaviors/policy"
)
_WEIGHTS_PATH = _ARTIFACT_DIR / "policy-smoke-v1.weights.json"
_FIXTURE_PATH = _ARTIFACT_DIR / "inference-parity.fixture.json"


def _load_weights_bytes() -> bytes:
    if not _WEIGHTS_PATH.exists():
        raise AssertionError(
            f"{_WEIGHTS_PATH} is missing. Run the recorded export "
            "(warwright_gym.training.export_policy) and commit its output -- see gym/EXPORT.md."
        )
    return _WEIGHTS_PATH.read_bytes()


def _load_fixture() -> dict:
    if not _FIXTURE_PATH.exists():
        raise AssertionError(
            f"{_FIXTURE_PATH} is missing. Run the recorded export "
            "(warwright_gym.training.export_policy) and commit its output -- see gym/EXPORT.md."
        )
    return json.loads(_FIXTURE_PATH.read_text())


def test_committed_weights_sha256_matches_the_fixtures_recorded_hash():
    weights_bytes = _load_weights_bytes()
    fixture = _load_fixture()

    assert hashlib.sha256(weights_bytes).hexdigest() == fixture["weightsSha256"]


def test_fixture_behavior_id_and_obs_encoding_version_match_the_committed_weights():
    weights = json.loads(_load_weights_bytes())
    fixture = _load_fixture()

    assert fixture["behaviorId"] == weights["behaviorId"]
    assert fixture["obsEncodingVersion"] == weights["obsEncodingVersion"]


def test_fixture_has_a_nonempty_case_set_all_at_or_above_its_declared_margin_epsilon():
    fixture = _load_fixture()

    assert len(fixture["cases"]) >= MIN_FIXTURE_CASES
    for case in fixture["cases"]:
        assert case["minMargin"] >= fixture["marginEpsilon"]


def test_fixture_cases_have_no_duplicate_observations():
    # hand_built_edge_case_observations mutates a rollout observation
    # template; a variant that turns out to be a NO-OP mutation (e.g. the
    # "skill ready" edge case when the template's skill is already ready)
    # would otherwise silently produce an exact duplicate of another case
    # -- see export_policy.generate_weights_and_fixture, which dedupes the
    # combined rollout+edge observation list before building fixture cases.
    fixture = _load_fixture()

    seen: set[tuple[int, ...]] = set()
    for index, case in enumerate(fixture["cases"]):
        key = tuple(case["obs"])
        assert key not in seen, f"case {index}: duplicate observation of an earlier case"
        seen.add(key)


def test_recomputed_actions_and_margins_match_the_committed_fixture_exactly():
    # Pinned per seed_everything's determinism contract (see
    # warwright_gym.training.ppo): a fixed weight forward pass has no RNG
    # in it, but pin threading anyway so this recomputation can never pick
    # up any thread-count-dependent floating-point reduction-order drift.
    torch.set_num_threads(1)

    weights = json.loads(_load_weights_bytes())
    fixture = _load_fixture()
    policy = weights_json_to_policy(weights)

    for index, case in enumerate(fixture["cases"]):
        obs = np.asarray(case["obs"], dtype=np.int64)
        action, margins = compute_action_and_margins(policy, obs)
        finite_margins = [margin for margin in margins if math.isfinite(margin)]
        min_margin = min(finite_margins) if finite_margins else float("inf")

        # "...exactly" (the test name) holds for the ACTION: it's an integer
        # per-component argmax, asserted with `==`, no tolerance. The
        # `minMargin` FLOAT is compared with `math.isclose` instead -- that
        # tolerance covers only float32 summation reduction-order variance
        # between this recomputation and the run that produced the committed
        # fixture, not any slack in the action itself.
        assert action == case["action"], f"case {index}: action drifted from the committed fixture"
        assert math.isclose(min_margin, case["minMargin"], rel_tol=1e-6, abs_tol=1e-6), (
            f"case {index}: minMargin drifted from the committed fixture "
            f"({min_margin} != {case['minMargin']})"
        )
