"""Mirrors packages/core/src/sim/observation.ts's LAYOUT CONSTANTS exactly --
never its math (encodeObservation itself is never re-implemented here; the
env only reads the flat vector the bridge already produced).

Field order (see observation.ts for the authoritative comment):
  self block:  hp, maxHp, x, y, attackCooldown, then one cooldownRemaining
               slot per warwright_gym.actions.SKILL_CATALOG entry, in that
               fixed catalog order (SKILL_COOLDOWN_ABSENT (-1) when the unit
               does not have that catalog skill equipped).
  unit block:  one per ally (ascending id, excluding self), then one per
               enemy (ascending id): id, hp, maxHp, x, y, squared distance
               to self.

gym/tests/test_protocol_golden.py pins OBS_SELF_FIELD_COUNT and
OBS_UNIT_FIELD_COUNT against the TS-generated fixture's `selfFieldCount`/
`unitFieldCount`, so a layout change on the TS side reddens this suite
mechanically.
"""

from __future__ import annotations

from warwright_gym.actions import SKILL_CATALOG

# Sentinel written into a self-block skill-cooldown slot when the unit does
# not have that catalog skill equipped. Ticks are always >= 0, so -1 can
# never collide with a real cooldown value.
SKILL_COOLDOWN_ABSENT = -1

# --- Self block (one per encodeObservation call) -------------------------
OBS_SELF_HP_INDEX = 0
OBS_SELF_MAX_HP_INDEX = 1
OBS_SELF_POS_X_INDEX = 2
OBS_SELF_POS_Y_INDEX = 3
OBS_SELF_ATTACK_COOLDOWN_INDEX = 4
# Slots [OBS_SELF_SKILL_COOLDOWN_START_INDEX, OBS_SELF_FIELD_COUNT) hold one
# cooldownRemaining slot per SKILL_CATALOG entry, in that fixed catalog
# order -- NOT per-unit skillIds order.
OBS_SELF_SKILL_COOLDOWN_START_INDEX = 5
OBS_SELF_FIELD_COUNT = OBS_SELF_SKILL_COOLDOWN_START_INDEX + len(SKILL_CATALOG)

# --- Per-unit block (one per ally, then one per enemy, ascending id) -----
OBS_UNIT_ID_OFFSET = 0
OBS_UNIT_HP_OFFSET = 1
OBS_UNIT_MAX_HP_OFFSET = 2
OBS_UNIT_POS_X_OFFSET = 3
OBS_UNIT_POS_Y_OFFSET = 4
OBS_UNIT_DISTANCE_SQUARED_OFFSET = 5
OBS_UNIT_FIELD_COUNT = 6


def compute_observation_length(num_allies: int, num_enemies: int) -> int:
    """Total flat-vector length for a self block plus `num_allies` ally
    blocks and `num_enemies` enemy blocks (excludes self from num_allies).
    Pure arithmetic over the layout constants above -- not simulation math;
    mirrors the shape encodeObservation always produces for a fixed build
    pair (packages/core/src/sim/observation.ts)."""
    return OBS_SELF_FIELD_COUNT + OBS_UNIT_FIELD_COUNT * (num_allies + num_enemies)
