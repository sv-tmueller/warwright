# Warwright gym encoding

This document is the precise, reproducible specification of the observation
and action encoding `warwright_gym.env` uses. It is meant to let a future
TypeScript exported-policy Behavior (see `CLAUDE.md`, "Content, learned
behaviors, and cosmetics") reproduce these exact numbers without reading the
Python source.

The **authoritative source of the math** is always
`packages/core/src/sim/observation.ts` (the encoder/decoder run inside the
Node gym-bridge subprocess). Nothing in `gym/` re-derives that math; this
package only mirrors the fixed **layout constants** and the **action-kind
code table**, pinned against a TS-generated fixture
(`gym/tests/fixtures/protocol_golden.json`) so any drift on the TS side
reddens the Python suite mechanically (`gym/tests/test_protocol_golden.py`).

## Observation space

`WarwrightVectorEnv.single_observation_space` /
`WarwrightEnv.observation_space` is:

```
Box(low=-1, high=np.iinfo(np.int64).max, shape=(L,), dtype=np.int64)
```

`L` is computed once at construction from the build pair and asserted
against the length of the actual reset frame's observation vector (fail
loud on any mismatch -- see `WarwrightVectorEnv._extract_agent_vector`):

```
L = SELF_FIELD_COUNT + UNIT_FIELD_COUNT * (num_allies + num_enemies)
SELF_FIELD_COUNT = 11   # 5 + len(SKILL_CATALOG) = 5 + 6
UNIT_FIELD_COUNT = 6
num_allies  = len(build_a.units) - 1   # excludes the external unit itself
num_enemies = len(build_b.units)
```

`L` is **fixed for the lifetime of a given build pair**: `world.units` never
shrinks (dead units stay in the array with `hp <= 0`), so every tick of
every match started from the same `build_a`/`build_b` produces a
same-length vector, win, loss, or draw.

### Self block (fields `0 .. SELF_FIELD_COUNT-1`)

One block per observation, always for the trainable (`external`) unit:

| Index | Field | Notes |
|---|---|---|
| 0 | `hp` | |
| 1 | `maxHp` | |
| 2 | `x` | integer arena coordinate |
| 3 | `y` | integer arena coordinate |
| 4 | `attackCooldownRemaining` | ticks |
| 5..10 | per-catalog-skill `cooldownRemaining` | one slot per `SKILL_CATALOG` entry, in catalog order (**not** the unit's own `skillIds` order) |

A catalog skill the unit does **not** have equipped reads `-1`
(`SKILL_COOLDOWN_ABSENT`) in its slot. Ticks are always `>= 0`, so `-1` can
never collide with a real cooldown value.

`SKILL_CATALOG` (fixed order, mirrors
`packages/core/src/content/data/skills.ts`, pinned by
`test_protocol_golden.py`):

```
["shield-bash", "guardian-ward", "cleave", "frost-bolt", "venom-shot", "mending-touch"]
```

### Unit blocks (fields `SELF_FIELD_COUNT ..`, `UNIT_FIELD_COUNT`-wide each)

One block per **ally** (ascending unit id, excluding self), then one block
per **enemy** (ascending unit id):

| Offset | Field | Notes |
|---|---|---|
| 0 | `id` | the unit's id (ascending, buildA units first, then buildB) |
| 1 | `hp` | |
| 2 | `maxHp` | |
| 3 | `x` | |
| 4 | `y` | |
| 5 | squared distance to self | integer, never `sqrt`'d (determinism contract) |

Block order is: all allies ascending id, then all enemies ascending id.
This is the **same order the action space's `target_slot` indexes** -- see
below.

### Padding-migration note (out of scope for #64)

There is currently **no padding convention**: `L` varies across different
build pairs, so a single trained policy's network input size is pinned to
the roster sizes it was trained against. Supporting variable rosters (e.g.
a policy trained on a 3v3 build playing a 2v2 match) would require a padded,
fixed-`L` observation layout in `observation.ts` itself (padded unit slots
with a sentinel, likely alongside an `OBS_ENCODING_VERSION` bump per
`CLAUDE.md`'s versioned-migration rule) -- **not** a Python-side patch. Not
needed for #64: `L` is computed once per env construction and stays fixed
for that env's lifetime because `build_a`/`build_b` are fixed at
construction.

## Action space

`WarwrightVectorEnv.single_action_space` / `WarwrightEnv.action_space` is:

```
MultiDiscrete([5, T, S, 1001, 1001])
```

| Component | Range | Meaning |
|---|---|---|
| 0: `kind` | `[0, 5)` | action kind code (table below) |
| 1: `target_slot` | `[0, T)`, `T = num_allies + num_enemies` | index into the observation's unit-block order (see above); unused for `idle`/`move` |
| 2: `skill_index` | `[0, S)`, `S = len(SKILL_CATALOG) = 6` | catalog index; unused except for `cast` |
| 3: `move_x` | `[0, 1001)` | raw arena x coordinate (`ARENA_MAX_X = 1000`); unused except for `move` |
| 4: `move_y` | `[0, 1001)` | raw arena y coordinate (`ARENA_MAX_Y = 1000`); unused except for `move` |

`move_x`/`move_y` use raw arena coordinates directly (the arena is
`1001 x 1001` integer points, `0..1000` inclusive per axis) -- no
discretization loss versus the core's own integer coordinate space.

### Target-slot convention

`target_slot` indexes the **same unit order the observation's unit blocks
use**: allies ascending id, then enemies ascending id. The env reads the
slot -> unit-id mapping once, from `UNIT_ID_OFFSET` (offset 0) of each unit
block in the **first reset frame** it sees; this mapping is stable for the
env's lifetime because unit ids are assigned purely from build order at
match init (never seed-dependent), and `build_a`/`build_b` are fixed at
construction.

### Action-kind code table (wire tuple `[kind, p1, p2, p3]`)

This table mirrors `packages/core/src/sim/observation.ts`'s
`encodeAction`/`decodeAction` and `warwright_gym/actions.py`'s
`encode_action`/`decode_action` EXACTLY. Unused wire slots are always `0`
(`decodeAction`/`decode_action` reject a non-zero unused slot).

| `kind` | Wire tuple | `MultiDiscrete` decode |
|---|---|---|
| 0 (`idle`) | `[0, 0, 0, 0]` | `[0, 0, 0, 0]` |
| 1 (`move`) | `[1, to.x, to.y, 0]` | `[1, move_x, move_y, 0]` |
| 2 (`move-toward`) | `[2, targetId, 0, 0]` | `[2, slot_to_unit_id[target_slot], 0, 0]` |
| 3 (`attack`) | `[3, targetId, 0, 0]` | `[3, slot_to_unit_id[target_slot], 0, 0]` |
| 4 (`cast`) | `[4, targetId, 0, skillIndex]` | `[4, slot_to_unit_id[target_slot], 0, skill_index]` |

### Invalid-but-well-formed actions are NOT filtered

The core resolves an invalid-but-well-formed action deterministically as a
no-op: an unknown/dead target, a target out of the skill's or attack's
range, a skill on cooldown, or a skill not equipped by the unit. `env.py`
never re-checks these (that would be rules in Python) -- every sampled
`MultiDiscrete` action decodes to a *wire-valid* tuple (all components are
in-range by construction), and the core's own `applyAction` gating in
`packages/core/src/sim/loop.ts` handles the rest.

## Seeding derivation

- `reset(seed=s)` calls `super().reset(seed=s)` (the base
  `gymnasium.vector.VectorEnv`/`gymnasium.Env` behavior), which seeds
  `self.np_random` only when `s is not None` (matching Gymnasium's normal
  "seed once at the start of training" convention).
- Per-sub-env replay seeds are drawn as uint32-range integers
  (`self.np_random.integers(0, 2**32, ...)`) from `self.np_random`, in
  **ascending sub-env index order**, once per `reset()` call.
- `AutoresetMode.NEXT_STEP` autoresets (a sub-env that reached `done` on
  step *k* is reset, not stepped, on step *k+1*) draw their new episode's
  replay seed from the **same** `self.np_random` stream, at the point they
  are evicted (i.e. interleaved with any ongoing draws for other
  autoresetting sub-envs in that same `step()` call, in ascending sub-env
  index order).
- Given the same `seed` to `reset()` and the same sequence of actions, a
  `WarwrightVectorEnv` run is fully deterministic: identical stacked
  observations, terminations, winners, and event-log hashes across runs
  (`gym/tests/test_env_rollout.py`'s determinism test).

## `ticks_per_step` semantics

`WarwrightVectorEnv(..., ticks_per_step=20)` (default: 20 = 1 second at the
core's 20 Hz tick rate). Each `step()` call advances every live sub-env by
`ticks_per_step` core ticks in one `Transport.step()` round trip. The
**same decoded action is replayed on every tick** within that window (the
core's `SteppedTransport.step(ticks, actions)` action-repeat semantics --
see `packages/core/src/api/seams.ts`); a caller that wants a fresh action
every tick should construct the env with `ticks_per_step=1` and call
`step()` in a loop.

## Reward and `info` contract

- `reward` is **always `0.0`** (#64 is explicitly "no reward shaping yet";
  see #65 for the reward-shaping module, which owns all reward semantics
  including any terminal win/loss signal).
- `info["replay_seed"]` is present on **every** frame (reset and step), one
  entry per sub-env: the seed that started that sub-env's *current*
  episode.
- `info["winner"]` / `info["hash"]` are present as `None` for every
  non-terminal sub-env entry, and set to the match's `winner`
  (`"A" | "B" | "draw"`) / event-log `hash` for a sub-env whose
  `terminated[i]` is `True` on that frame. A freshly (auto)reset sub-env is
  never terminal in the same frame it was reset in.
- `terminated[i] = frame.done` (a real match outcome -- win, loss, or the
  core's own `MATCH_TICK_CAP` draw -- is not an env truncation).
  `truncated` is always `False`: `WarwrightVectorEnv` never imposes its own
  episode length limit.

## Cross-references

- `packages/core/src/sim/observation.ts` -- the authoritative encoder/
  decoder (layout math, `OBS_ENCODING_VERSION`).
- `packages/core/src/content/data/skills.ts` -- the skill catalog order.
- `packages/core/src/sim/constants.ts` -- `EXTERNAL_BEHAVIOR_ID`,
  `RULESET_VERSION`, `ARENA_MAX_X`/`ARENA_MAX_Y`, `MATCH_TICK_CAP`.
- `packages/gym-bridge/src/session.ts` -- the batched NDJSON wire protocol
  this env's `Transport` speaks.
- `warwright_gym/observation.py` -- the layout-constant mirror (never the
  math).
- `warwright_gym/actions.py` -- the action-kind code mirror.
- `warwright_gym/env.py` -- this encoding, wired into Gymnasium spaces.
