from __future__ import annotations

import json
from pathlib import Path

import pytest

from warwright_gym.actions import encode_action
from warwright_gym.transport import BridgeError, Transport, default_bridge_path, ensure_bridge_built

REPO_ROOT = Path(__file__).resolve().parents[2]
WARBAND_A = json.loads((REPO_ROOT / "builds" / "warband-a.json").read_text())
WARBAND_B = json.loads((REPO_ROOT / "builds" / "warband-b.json").read_text())
SEED = 42
RULESET_VERSION = 2  # keep in sync with packages/core/src/sim/constants.ts
GOLDEN_HASH = 1754985129  # pinned in the #63 SUB_PLAN: transport == direct runMatch


def test_default_bridge_path_points_at_the_built_bridge():
    path = default_bridge_path()
    assert path.name == "main.js"
    assert path.parts[-3:-1] == ("gym-bridge", "dist")


def test_reset_then_step_reaches_a_result_matching_direct_core_runmatch(transport):
    replay = {"version": RULESET_VERSION, "seed": SEED, "buildA": WARBAND_A, "buildB": WARBAND_B}

    reset_frames = transport.reset([{"envId": 0, "replay": replay}])
    assert reset_frames[0]["envId"] == 0
    assert reset_frames[0]["done"] is False

    step_frames = transport.step([{"envId": 0, "ticks": 10_000}])
    frame = step_frames[0]
    assert frame["done"] is True
    assert frame["result"]["winner"] == "B"
    assert frame["result"]["hash"] == GOLDEN_HASH


def test_batches_multiple_envs_in_one_round_trip(transport):
    replay = {"version": RULESET_VERSION, "seed": SEED, "buildA": WARBAND_A, "buildB": WARBAND_B}

    reset_frames = transport.reset(
        [{"envId": 0, "replay": replay}, {"envId": 1, "replay": replay}]
    )
    assert [frame["envId"] for frame in reset_frames] == [0, 1]

    step_frames = transport.step(
        [{"envId": 0, "ticks": 10_000}, {"envId": 1, "ticks": 10_000}]
    )
    assert len(step_frames) == 2
    for frame in step_frames:
        assert frame["done"] is True
        assert frame["result"]["hash"] == GOLDEN_HASH


def test_external_unit_actions_flow_through_the_bridge_and_decode(transport):
    replay = {
        "version": RULESET_VERSION,
        "seed": SEED,
        "buildA": {
            "name": "External A",
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
            "name": "Target B",
            "units": [
                {
                    "roleId": "mender",
                    "skillIds": [],
                    "behaviorId": "protect-allies",
                    "position": {"x": 10, "y": 0},
                }
            ],
        },
    }

    reset_frames = transport.reset([{"envId": 0, "replay": replay}])
    assert list(reset_frames[0]["obs"].keys()) == ["0"]

    attack = encode_action({"kind": "attack", "targetId": 1})
    step_frames = transport.step(
        [{"envId": 0, "ticks": 1, "actions": {"0": attack}}]
    )
    assert step_frames[0]["done"] is False


def test_unknown_env_id_raises_bridge_error(transport):
    with pytest.raises(BridgeError, match="999"):
        transport.step([{"envId": 999, "ticks": 1}])


def test_poisoned_env_stays_unsteppable_until_reset(transport):
    """Pairs with the gym-bridge session.ts eviction fix (#63 review finding
    2): a living external unit stepped with no injected action raises
    BridgeError, and a subsequent step on that same envId must ALSO error
    (not silently return a corrupted world) until reset is called again."""
    replay = {
        "version": RULESET_VERSION,
        "seed": SEED,
        "buildA": {
            "name": "External A",
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
            "name": "Target B",
            "units": [
                {
                    "roleId": "mender",
                    "skillIds": [],
                    "behaviorId": "protect-allies",
                    "position": {"x": 10, "y": 0},
                }
            ],
        },
    }

    transport.reset([{"envId": 0, "replay": replay}])

    # No action for the living external unit -> the core throws mid-tick.
    with pytest.raises(BridgeError):
        transport.step([{"envId": 0, "ticks": 1}])

    # A naive re-step of the same envId must keep erroring (eviction), not
    # silently succeed against a corrupted world.
    with pytest.raises(BridgeError, match="unknown envId 0"):
        transport.step(
            [{"envId": 0, "ticks": 1, "actions": {"0": encode_action({"kind": "idle"})}}]
        )

    # reset re-arms it.
    reset_again = transport.reset([{"envId": 0, "replay": replay}])
    assert reset_again[0]["done"] is False


def test_spawning_a_nonexistent_bridge_file_raises_bridge_error(tmp_path):
    missing = tmp_path / "does-not-exist.js"
    with pytest.raises(BridgeError):
        with Transport(missing) as bad_transport:
            bad_transport.reset(
                [
                    {
                        "envId": 0,
                        "replay": {
                            "version": RULESET_VERSION,
                            "seed": SEED,
                            "buildA": WARBAND_A,
                            "buildB": WARBAND_B,
                        },
                    }
                ]
            )


def test_ensure_bridge_built_raises_a_clear_run_pnpm_build_first_message(tmp_path):
    missing = tmp_path / "main.js"
    with pytest.raises(FileNotFoundError, match="pnpm --filter @warwright/gym-bridge build"):
        ensure_bridge_built(missing)


def test_ensure_bridge_built_returns_the_path_when_present(tmp_path):
    present = tmp_path / "main.js"
    present.write_text("")
    assert ensure_bridge_built(present) == present
