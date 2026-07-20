# Gate 4 decisions: content-batch scope + visual identity

> **RECOMMENDATIONS — pending human ratification at the next batch sign-off (batch #139 guardrail).**
> Nothing in this document is authorized to be built, spent, or merged as content, engine, or art. It is a
> written recommendation only. Ratification happens at the next batch sign-off; until then #70 and #74 stay
> in their current (blocked/scouted) state.

Spike: #69, batch #139. Blocked by: #68 (Gate 3, closed). Produced by re-surveying the repo at the HEAD
commit checked out for this spike (`efcdfb5`), per the sub-plan's re-verification step — see "Survey" below
for what was re-checked and where it corrected the sub-plan's numbers (nowhere: everything matched).

## Survey (re-verified at HEAD, not copied from the sub-plan)

| Item | Location | Finding |
|---|---|---|
| Roles | `packages/core/src/content/data/roles.ts` | 4: `vanguard`, `warden`, `reaver`, `mender` |
| Skills | `packages/core/src/content/data/skills.ts` | 6: `shield-bash`, `guardian-ward`, `cleave`, `frost-bolt`, `venom-shot`, `mending-touch` |
| Registered Behaviors | `packages/core/src/content/behaviors/index.ts` | 4: `aggroLowestHp`, `protectAllies`, `focusCasters`, `policySmokeV1` (the `external` sentinel in `sim/constants.ts` is explicitly excluded — an injection seam, not a selectable Behavior) |
| Effect kinds | `packages/core/src/sim/vocab.ts` | 3: `direct-damage`, `heal`, `apply-status`. Comment: "Frozen contract: downstream ... consumes these and does not extend them here." |
| Status kinds | `packages/core/src/sim/vocab.ts` | 3: `slow`, `shield`, `dot` |
| `UnitBuildSchema` | `packages/core/src/content/schemas.ts` | `{ roleId, skillIds, behaviorId, position }`, `z.strictObject`. No augment slot. `grep -ri augment packages/core/src` returns nothing. |
| `Unit` (sim runtime shape) | `packages/core/src/sim/types.ts` | Single-slot `slow: StatusState \| null`, `shield: StatusState \| null`, plus `activeDots: DotState[]` (array, since `dot` can stack) |
| `RULESET_VERSION` | `packages/core/src/sim/constants.ts:7` | `2` |
| `OBS_ENCODING_VERSION` | `packages/core/src/sim/observation.ts:20` | `1`. Self-block encodes `hp`, `maxHp`, `pos.x/y`, `attackCooldownRemaining`, and one cooldown slot per catalog Skill; per-unit block encodes `id`, `hp`, `maxHp`, `pos.x/y`, squared distance. Neither block encodes `armor`, `moveSpeed`, `attackDamage`, `attackRangeSquared`, or `attackCooldownTicks` as standalone fields. |
| `AssetProvider` seam | `packages/web/src/assets/provider.ts` | 4 draw functions (`drawRoleSilhouette`, `drawSkillIcon`, `drawBar`, `drawStatusIndicator`); `proceduralProvider` is the only active provider; `resolveAssetProvider(override) = override ?? proceduralProvider`, a pure, off-by-default selector. Header comment already documents Kenney.nl (CC0) and game-icons.net (CC BY 3.0) as candidate sources, "nothing bundled." |
| `docs/BUILD_PLAN.md` Section C | Asset strategy | Procedural is primary ("thematically coherent... an abstract, synthetic, geometric look reads as intentional"); CC0/CC-BY fallback is "documented, off by default... add only through a thin AssetProvider adapter... Do not bundle third-party assets during the build phases"; AI-generated raster art is explicitly "Not now... Revisit only at Phase 4." |

Every count in the architect's sub-plan matched HEAD exactly. No correction was needed.

---

## 1. Content-batch scope (Phase 4)

### Recommendation

Ship **2 new Roles, 4 new Skills, 1 new engine primitive (augments) with 3 augment instances**, plus **2
new status kinds** (a stun/root, and a positive buff) needed by two of the new Skills. This is deliberately
small enough to land as one `RULESET_VERSION` bump (v2 -> v3) with one golden-replay regeneration, while
being large enough to give the Phase-4 roster genuine new tactical shapes (crowd control, a buff-based
support pattern, and stat-modifying loadout choices) instead of only recombining existing primitives. **The
4 new Skills also force a second, independent version bump — `OBS_ENCODING_VERSION` v1 -> v2 — because they
grow the skill catalog that the observation encoder's self-block is sized against; see the corrected
analysis and its honest-cost pricing under "Mandatory augment-primitive subsection" below (an earlier draft
of this document wrongly scoped that analysis to augments only and claimed the batch was "not affected").**

Reuse-only headroom is large and cheap: **any** new Role is just a new stat-line (`maxHp`, `armor`,
`moveSpeed`, `attack`) against the existing `RoleSchema` — no bump. **Any** new Skill that combines the 3
existing effect kinds (`direct-damage`, `heal`, `apply-status`) x the 3 existing status kinds (`slow`,
`shield`, `dot`) x the 3 existing target kinds (`enemy`, `ally`, `self`) with new cooldown/range/magnitude
numbers is also free of a ruleset bump, as long as it doesn't change the golden-replay build's actual match
outcome (a *new* Skill/Role only bumps the version if it is used by a build that a golden-path snapshot
covers; adding unused catalog entries does not by itself change any existing replay). This recommendation
deliberately uses only two genuinely-new primitives (stun/root and buff) rather than pricing all five
candidates into the batch — see "Priced but not selected" below for the other three.

### Per-item table

| # | Item | Kind | Sketch | Reuses existing primitive? | New primitive needed | Ruleset bump? |
|---|---|---|---|---|---|---|
| 1 | Skirmisher | Role | Fast, low-hp, short-range harasser (high `moveSpeed`, low `maxHp`/`armor`) | Yes — `RoleSchema` stat-line only | none | No |
| 2 | Bulwark | Role | Very tanky, very short range, high armor (extreme `maxHp`/`armor`, low `moveSpeed`) | Yes — `RoleSchema` stat-line only | none | No |
| 3 | Piercing Shot | Skill | `direct-damage`, `enemy` target, high range/magnitude | Yes — existing `direct-damage` effect + `enemy` target | none | No |
| 4 | Battle Cry | Skill | `apply-status: shield`, `ally` target, short cooldown | Yes — existing `apply-status`/`shield` + `ally` target | none | No |
| 5 | Crippling Strike | Skill | `apply-status: stun-or-root`, `enemy` target — briefly disables acting/moving | No | **stun/root status kind** | Yes |
| 6 | Rally | Skill | `apply-status: haste-or-damage-up`, `ally` target — positive buff | No | **buff status kind** (haste/damage-up) | Yes |
| 7 | Iron Plating | Augment | `+armor` init-time stat delta | Partial — reuses `Unit.armor`, but needs the augment slot/apply step | **augment primitive** (see below) | Yes (shared with #8, #9, #10) |
| 8 | Swift Boots | Augment | `+moveSpeed` init-time stat delta | Partial — reuses `Unit.moveSpeed` | **augment primitive** | Yes (same bump) |
| 9 | Vital Surge | Augment | `+maxHp`(and `+hp`) init-time stat delta | Partial — reuses `Unit.maxHp`/`hp` | **augment primitive** | Yes (same bump) |

**The primitives items 5, 6, and 7-9 need** — the stun/root status kind, the buff status kind, and the
augment schema/registry/application respectively — all land under **one** `RULESET_VERSION` bump and **one**
golden-replay regeneration in a single engine-primitives commit (Slice A in the #70 split below). The
*content* itself (Crippling Strike, Rally, Iron Plating/Swift Boots/Vital Surge) lands afterward, in Slices C
and D — bumping once for a batch of primitives is preferable to bumping once per primitive, since each bump
forces a full re-validation pass and an explanatory note; batching the explanation once is clearer than three
near-duplicate notes.

**Note on the "Ruleset bump?" column above.** That column tracks `RULESET_VERSION` only (combat-semantics
changes). It is a *separate axis* from `OBS_ENCODING_VERSION` (observation-layout changes): as corrected
below, adding **any** of the 4 new Skills — including the reuse-only ones (items 3, 4), which correctly show
"No" for `RULESET_VERSION` — still grows the compiled-in skill catalog and therefore *does* require an
`OBS_ENCODING_VERSION` bump. "No `RULESET_VERSION` bump" must not be read as "no version bump of any kind."

### Priced but not selected

The sub-plan asked that all five genuinely-new-primitive candidates be evaluated and individually priced,
even though this recommendation only selects two of them for the batch:

| Candidate | Price if added | Selected this batch? |
|---|---|---|
| AoE targeting (skill hits multiple units, not `enemy\|ally\|self` single-target) | New `target` kind + new resolve-time multi-target logic in the skill-effect resolver; `RULESET_VERSION` bump + golden regen; `schemas.ts`'s `TARGET_KINDS` grows | No — deferred; single-target coverage is not exhausted yet (see reuse headroom above) |
| Stun/root status | New `STATUS_KINDS` entry in `vocab.ts` + a "cannot act/move" branch in the tick loop's decide/resolve step; bump + regen | **Yes** (item 5, Crippling Strike) |
| Positive buff status (haste / damage-up) | New `STATUS_KINDS` entry + a multiplicative-or-additive modifier applied at attack/move resolution; bump + regen | **Yes** (item 6, Rally) |
| Heal-over-time (HoT) | Could reuse the existing `DotState`-shaped array with a *positive* per-tick delta, but `vocab.ts`'s `dot` status is documented as damage-only; a HoT is more honestly a distinct status kind than an overload of `dot`; bump + regen | No — deferred; `Mending Touch` already covers direct healing |
| Lifesteal | Not a status at all — a resolve-time hook that redirects a fraction of `direct-damage` dealt back to the attacker's `hp`; new effect-resolution branch, not a new `EffectKind`; bump + regen | No — deferred; no roster gap it fills yet, revisit once actual playtesting shows sustain is missing |

### Mandatory augment-primitive subsection

**Augments do not exist today.** `grep -ri augment packages/core/src` returns nothing, and
`UnitBuildSchema` has no augment slot. This recommendation defines the minimal primitive needed to support
items 7-9 above:

- **Schema + registry**: an `AugmentSchema` (id, name, and a small closed set of stat-delta fields — e.g.
  `maxHpDelta`, `armorDelta`, `moveSpeedDelta`, all integers, all optional, applied additively) validated by
  Zod, plus a content registry entry, mirroring how Roles/Skills/Behaviors are already registered
  (`createContentRegistry`).
- **`UnitBuildSchema` change**: an `augmentIds: z.array(AugmentIdSchema)` slot (default `[]` for backward
  compatibility with existing builds), since the schema is currently `z.strictObject({ roleId, skillIds,
  behaviorId, position })` with no room for extra fields under `strictObject`'s closed-shape semantics.
- **Application point**: `sim/init.ts`'s `buildUnit` applies each augment's stat deltas to the
  Role-derived fields (`maxHp`, `hp`, `armor`, `moveSpeed`, ...) once, at unit construction, before the
  first tick — never as an ongoing per-tick effect. This keeps augments in the same "init-time shaping"
  category as a Role's own stat-line, not a new runtime mechanic.

**Honest cost.** This is a change to the replay input shape (`UnitBuild`, which flows into
`{ version, seed, buildA, buildB }`), so it requires:
1. A `RULESET_VERSION` bump (v2 -> v3) **even before any augment is actually used** by a golden-path build,
   because the shape of a valid build itself changed.
2. A golden-replay snapshot regeneration (`pnpm --filter @warwright/core gen-golden`) in the same commit,
   with a note explaining the bump is schema-shape, not a rules change to any *existing* build.
3. A ripple into `packages/server`'s build-snapshot validation: the server pins the ruleset version and
   snapshots builds at match time, so its build-acceptance schema must also learn the `augmentIds` field
   or it will reject (or silently drop) every future build that uses one.
4. A ripple into `packages/web`'s builder UI: the browser warband builder needs a new input surface to let
   a player pick augments per unit; this is UI-sizing work, not a schema change, and is its own likely M
   slice in the #70 split below (or split further into #70/#74-adjacent work if the split wants it separate
   from #70).

**Is `OBS_ENCODING_VERSION` affected?**

**By the augment primitive alone: no.** `observation.ts`'s self-block encodes `hp`, `maxHp`, `pos.x/y`,
`attackCooldownRemaining`, and one cooldown slot per catalog Skill; the per-unit block encodes `id`, `hp`,
`maxHp`, `pos.x/y`, and squared distance. Augments apply init-time deltas to `Unit.maxHp`/`hp`/`armor`/
`moveSpeed`, and of those, only `hp`/`maxHp` are ever read by the encoder — as *values*, not as a new field.
An augmented unit's `hp`/`maxHp` just carry different (still integer) numbers through the same slots; the
field order, field count, and the per-skill cooldown layout are all unchanged by the augment primitive in
isolation. `armor` and `moveSpeed` are not observation fields at all today, so augmenting them changes
nothing about the encoder's layout either.

**By the batch as a whole: yes — this document's earlier draft was wrong to call the batch "not affected,"**
and that error is corrected here rather than silently fixed, since it was checked off in the guardrail
checklist below. The augment-only analysis above answered a narrower question than the one the guardrail
checklist actually claims to answer ("is `OBS_ENCODING_VERSION` affected [by this batch]"). The batch also
proposes 4 new Skills (items 3-6), and those grow the compiled-in skill catalog
(`packages/core/src/content/data/skills.ts`, re-exported as `skills` and imported into `observation.ts` as
`skillCatalog`) from 6 entries to 10. `observation.ts`'s own constants make the consequence mechanical, not
a matter of interpretation:

```ts
// packages/core/src/sim/observation.ts:44-45
export const OBS_SELF_SKILL_COOLDOWN_START_INDEX = 5;
export const OBS_SELF_FIELD_COUNT = OBS_SELF_SKILL_COOLDOWN_START_INDEX + skillCatalog.length;
```

`OBS_SELF_FIELD_COUNT` is derived directly from `skillCatalog.length`, so it grows from `5 + 6 = 11` today to
`5 + 10 = 15` once all 4 new Skills exist, for **every** unit's self-block, regardless of which Skills that
particular unit has equipped — the self-block layout is intentionally build-independent so any two units are
comparable slot-for-slot (see the field's own comment, `observation.ts:37-43`). A field-count change to a
layout that has already shipped is exactly the case the file's header calls out:

> OBS_ENCODING_VERSION is the parity ground truth for every future exported policy ... once a version ships,
> ANY layout change here (field order, field count, the action tag table) is a breaking migration and must
> bump this constant. — `observation.ts:11-14`

This is triggered by catalog growth **alone**, independent of the `RULESET_VERSION` question above: it fires
for the two reuse-only Skills (items 3, 4, Piercing Shot and Battle Cry) exactly as it does for the two
new-primitive Skills (items 5, 6, Crippling Strike and Rally), because all four are new rows appended to
`skills.ts` regardless of which effect/status kinds they use. **Conclusion: the recommended batch requires
an `OBS_ENCODING_VERSION` bump, v1 -> v2, as soon as any of the 4 new Skills lands** — this is in addition
to, and independent of, the `RULESET_VERSION` v2 -> v3 bump priced above for the augment/status-kind engine
primitives.

**Is the action tag table affected too?** Checked, per the header's explicit mention of "the action tag
table" as a breaking-migration trigger. The *kind-code* table itself
(`ACTION_KIND_IDLE`/`MOVE`/`MOVE_TOWARD`/`ATTACK`/`CAST` = `0..4`, `observation.ts:145-149`) is a fixed
5-entry table unrelated to catalog size — it is **not** affected by catalog growth; the 5 action kinds stay
the same before and after this batch. What *is* catalog-sized is a `cast` action's `skillIndex` payload
(tuple slot `p3`): `encodeAction` computes it as `skillCatalog.findIndex(...)` (`observation.ts:162`) and
`decodeAction` reads it back as `skillCatalog[p3]` (`observation.ts:213`), so its valid range widens from
`0..5` to `0..9`. That same catalog list is duplicated byte-for-byte on the Python side —
`gym/warwright_gym/actions.py`'s `SKILL_CATALOG` constant, whose own header states `gym/tests/
test_protocol_golden.py` "cross-checks this list EXACTLY (order and all, not just length) against the
TS-generated fixture" (`gym/tests/fixtures/protocol_golden.json`, produced by `pnpm --filter
@warwright/gym-bridge gen-fixture`) — so growing the catalog also requires updating that Python list (to
add the 4 new skill ids in catalog order) and regenerating that fixture in the same change, not just bumping
a version number.

**Honest cost of the `OBS_ENCODING_VERSION` bump.** Folded into the same honest-cost accounting as the
`RULESET_VERSION` bump above, since both are triggered by this same recommended batch:

1. `OBS_ENCODING_VERSION` bump, v1 -> v2 (`packages/core/src/sim/observation.ts:20`), the moment any of the
   4 new Skills is added to `skills.ts`.
2. **Ripple onto `policySmokeV1`, and it is a *build-breaking* ripple, not merely a stale-artifact one.**
   `packages/core/src/content/behaviors/policy/weights-schema.ts`'s `parsePolicyWeights` throws if
   `weights.obsEncodingVersion !== OBS_ENCODING_VERSION` (`weights-schema.ts:73-78`), and this check runs at
   **module load**, not at Behavior-selection time: `policySmokeV1Weights` is computed as a top-level
   `parsePolicyWeights(policySmokeV1WeightsJson)` call (`weights-schema.ts:86`), and `policySmokeV1` is
   re-exported from `content/behaviors/index.ts`'s registered-Behaviors barrel. So bumping
   `OBS_ENCODING_VERSION` to 2 without also updating the committed
   `policy-smoke-v1.weights.json` (still pinned to `obsEncodingVersion: 1`) does not just make that one
   Behavior unselectable — it throws as soon as anything imports the core package's Behaviors barrel,
   breaking the build for every runtime (CLI, web, server) until resolved. This must be treated as a
   same-commit blocking dependency of the catalog-growth + encoder-bump slice, not a follow-up.
   - **Recommend: deprecate/unregister `policySmokeV1` in the same commit as the bump**, rather than
     re-export/re-train it immediately. Rationale: re-training and re-exporting a policy is a full
     Python/gym round-trip (a PPO training run through `gym/`, `export_policy.py`, a new parity fixture) —
     disproportionate work to gate a content-catalog batch on. The encoder-migration slice's job is to keep
     the build green through the layout change, not to retrain a policy; re-export can land as independent
     follow-up work, at any later time, against the new `OBS_ENCODING_VERSION = 2` encoding, using the
     existing `gym/EXPORT.md` pipeline unchanged. The alternative (re-export inline) is not recommended
     because it would silently balloon this batch's scope from a data-only content change into an ML
     training task with its own nondeterminism-adjacent surface (training runs, not sim ticks) to review.
   - Deprecating means: remove the `policySmokeV1` export from `content/behaviors/index.ts` so it is no
     longer a selectable Behavior, and quarantine (move out of the loaded module graph, or delete pending a
     follow-up re-export issue) `policy-smoke-v1.weights.json`, its parity fixture, and its dedicated tests
     so the module-load-time check in `weights-schema.ts` has nothing stale to validate against.
3. **Affected artifacts — full ledger, re-verified against HEAD (round-2 correction).** A round-1 reviewer
   pass on this document found that the previous draft under-priced this by scoping "affected artifacts" to
   the policy folder plus two gym files. The actual blast radius, checked file-by-file at HEAD, is
   considerably wider:
   - `packages/core/src/content/behaviors/policy/policy-smoke-v1.weights.json` — the pinned weights JSON
     (`obsEncodingVersion: 1`), deprecated per above.
   - `packages/core/src/content/behaviors/policy/inference-parity.fixture.json` — the TS-side inference
     parity fixture, captured against v1 observations; stale under v2 and removed/deprecated alongside the
     weights.
   - `gym/tests/fixtures/protocol_golden.json` — the gym-side protocol fixture; regenerated via `pnpm
     --filter @warwright/gym-bridge gen-fixture` once the full 10-entry catalog exists.
   - `gym/warwright_gym/actions.py` — its `SKILL_CATALOG` list (must gain the 4 new skill ids, in catalog
     order) and its own `OBS_ENCODING_VERSION = 1` mirror constant (bumped to 2), both cross-checked against
     the regenerated fixture by `gym/tests/test_protocol_golden.py`.
   - `packages/core/src/index.ts:42` — the public API re-exports the `policySmokeV1` Behavior OBJECT by
     name (not just its id), with a doc comment there explaining this is the one deliberate exception to
     "ids only" specifically so a foundry submission can reuse its trained `decide` function under a new id.
     Deprecating means removing this export.
   - `packages/core/src/index.ts:49-54` — the public `behaviorIds` enumeration includes `policySmokeV1.id`;
     consumed by `packages/server/src/warbands/routes.ts`'s `behaviorIdSet` (write-time content validation)
     and `packages/web/src/warband-io.ts:44`'s `KNOWN_BEHAVIOR_IDS`, plus `packages/web/src/
     WarbandBuilder.tsx`'s dropdown and default-selection logic. **No server or web code changes are needed
     here**: both consume `behaviorIds` by reuse (the same "defaulted/derived field propagates automatically"
     reasoning as Slice E's `augmentIds` correction below), so the id simply disappears from validation and
     the builder UI once removed from the array.
   - **Already-stored server warbands.** `BehaviorIdSchema` is a bare `z.string().min(1)` (not an enum), and
     `findUnknownContentId` (the only place `behaviorIds` gates a behaviorId) runs only in the POST and PUT
     handlers, not GET — so an existing row with `behaviorId: "policy-smoke-v1"` stays readable via GET
     forever; nothing re-validates it against the shrunk set on read. Two real consequences remain, though:
     (a) any future PUT (edit-and-resave) of such a row now 400s with "Unknown behaviorId" until the caller
     changes it — a silent lock on further edits, not data loss; (b) `packages/server/src/matches/
     resolve.ts`'s `resolveMatch` calls core's `runMatch` directly on an already-stored build with no
     behaviorId content check of its own (only `parseWarband`'s Zod shape check, which does not look at
     `behaviorIds`), so `runMatch`'s content registry (`content/registry.ts:46-49`) would throw `Unknown
     behavior id: policy-smoke-v1` uncaught if that build were ever resolved — that file's own comment notes
     "No HTTP endpoint wraps this in this slice," so this is not reachable via HTTP today, but would become
     a live 500 once a queue endpoint calls it. This document does not code a migration for this (there is
     no production traffic in this pre-launch repository, so today this is almost certainly zero rows), but
     ratification should confirm the actual `warbands` table has no such rows before this lands, or add a
     one-time reassignment (e.g., to `aggro-lowest-hp`) to the same slice if it ever does.
   - `packages/core/src/sim/seed-registry.ts:30` — `createSeedRegistryWith` unconditionally registers
     `policySmokeV1` into every match's Behavior registry (the shared assembly `init.ts`/`match.ts` both use,
     so `runMatch` and `createSteppedMatch` cannot diverge); the registration line is removed.
   - `packages/core/src/content/behaviors/index.ts` (the registered-Behaviors barrel) drops its
     `policySmokeV1` re-export; `packages/core/src/content/behaviors/index.test.ts`'s two assertions on
     `policySmokeV1.id` and its registration are removed or repointed at the remaining three Behaviors.
   - `packages/core/src/sim/policy-smoke-v1-match.test.ts` (the dedicated full-`runMatch` integration
     coverage for this Behavior) plus its demo build fixtures, `builds/policy-1v1-a.json` and
     `builds/policy-1v1-b.json` (both reference `"behaviorId": "policy-smoke-v1"`) — all three are removed
     together, since the test would otherwise fail the moment the registration above is gone.
   - **The entire foundry surface.** `packages/foundry/submissions/sample-policy/behavior.ts:16,20` imports
     `policySmokeV1` from `@warwright/core` by name (`import { policySmokeV1 } from '@warwright/core'`) to
     wrap its `decide` under a new submission id — the one deliberate consumer `index.ts:42`'s export exists
     for. `packages/foundry/tsconfig.json` includes `submissions` in its typecheck scope, so removing the
     named export breaks `pnpm -r typecheck` immediately unless this submission is also retired in the same
     commit, not just its downstream tests. Five foundry test files exercise `sample-policy` and would fail
     or need updating once it is retired: `validate.test.ts` (the canonical full N=25-seed gauntlet pass —
     "THE canonical full-N=25 exported-policy end-to-end test" per its own comment), `stage3.test.ts`
     (the 1v1-shape pass-the-bar case), `reproducibility.test.ts` (its 5-seed determinism check),
     `baseline.test.ts` (its `oneVOneManifest` fixture), and `cli-e2e.test.ts` (references it in a comment
     as the canonical case it builds on). `stage3.ts:11`'s comment records `sample-policy`'s expected win
     rate for documentation purposes and should be updated or removed alongside.
   - `.github/workflows/ci.yml:43-44` — the per-push CI gate runs `pnpm foundry:validate packages/foundry/
     submissions/sample-policy` unconditionally; left as-is, this line fails CI the moment the submission
     import breaks. It must be removed (or repointed at a replacement submission) in the same commit.
   - **Consequence for the Phase 3 DoD.** Retiring `sample-policy` without an immediate replacement means
     the Phase 3 Definition of Done's "Foundry CI accepts a valid Behavior" clause is proven going forward
     only by the rule-based `sample-aggro` submission, not by an exported-policy one — the exported-policy
     half of that proof temporarily lapses. This document recommends filing a tracked follow-up issue to
     re-author a v2-trained exported-policy sample submission once one exists, rather than silently letting
     that gap go unrecorded; it is explicitly out of this batch's scope, which is content-only and does not
     retrain a policy (see the re-argued recommendation immediately below for why inline retraining is still
     rejected).

### Re-argued: deprecate vs. re-export vs. a frozen-encoder shim, against the full ledger

The sub-plan's original "deprecate, don't re-export inline" reasoning was argued against a ledger scoped to
the policy folder plus two gym files. Re-argued here against the full ledger above (index.ts, seed-registry,
the behaviors barrel and its test, the match-integration test and its build fixtures, and the entire foundry
surface including its per-push CI gate):

- **Option 1 — deprecate/unregister (this document's recommendation, unchanged).** The ledger is wide but
  every item on it is mechanical: removing an export, a registry registration, a barrel re-export, a handful
  of test files and fixtures, and one CI line — no new runtime logic, no retraining, no change to any engine
  contract. It is one atomic commit (Slice G below, co-landed with Slice C's encoder bump) with a bounded,
  enumerable diff. Its real costs, both now named explicitly rather than assumed away, are: the
  already-stored-warband edge case above (believed nil pre-launch, must be confirmed at ratification) and
  the temporary Phase 3 DoD evidence gap above (tracked via a named follow-up issue, not silently dropped).
- **Option 2 — re-export/re-train inline.** Still rejected, and the full ledger does not change that: a
  freshly-trained v2 policy would still need every plumbing change on the ledger above (a new weights file,
  a new parity fixture, updated foundry submission content, a still-updated `gym/warwright_gym/actions.py`
  and `protocol_golden.json`) — it does not shrink the ledger, it only avoids the word "deprecate" by
  replacing the same set of artifacts with freshly-trained ones instead of removing them. Doing that inline
  still means folding a full PPO training round-trip (`gym/`, `export_policy.py`, a new parity fixture) into
  a batch whose actual job is landing content-catalog data — the scope-creep risk already identified stands,
  now weighed against the wider ledger rather than assumed.
- **Option 3 — a frozen v1-encoder shim (raised by round-1 review; evaluated, not selected).** The idea:
  pin `policySmokeV1`'s own inference to a version-frozen observation encoding, independent of the live,
  growing `OBS_ENCODING_VERSION`, so its weights, its tests, and the foundry submission never need to change
  at all, no matter how large the skill catalog grows later. Checked against the actual code: `Behavior.decide`
  (`sim/behavior.ts`) only ever receives a `WorldView`, the seam that intentionally hides all engine
  internals from Behaviors; `policySmokeV1`'s own `decide` (`policy-smoke-v1.ts`) calls `world.observationOf
  (self)`, which is bound to the live, catalog-derived `OBS_SELF_FIELD_COUNT`/`OBS_UNIT_FIELD_COUNT`, not a
  per-policy pinned version, and `weights-schema.ts`'s validation is written against one global "current"
  `OBS_ENCODING_VERSION`, not a per-policy pinned one. Making any policy durable across future catalog growth
  this way needs a new, first-class "multiple observation-encoder versions coexist at runtime" capability on
  the `WorldView`/`Behavior` seam — a genuine change to the sim's public contract, unscoped by this spike's
  sub-plan, and risk-bearing precisely because it touches the same `observation.ts` contract this document's
  own guardrail calls "the parity ground truth for every future exported policy." It is a real, appealing
  answer to the *general, recurring* problem (every future content batch that grows the catalog will
  re-trigger this same choice for whatever policies are live then) — this document recommends it be raised
  as its own follow-up spike ("should exported policies be encoder-version-pinned so catalog growth never
  retires them?"), not adopted ad hoc inside a content-scope batch. Folding a new engine capability into a
  docs-only recommendation about content sizing would itself be the kind of unpriced scope-creep the #139
  guardrail exists to prevent.

**Conclusion: the recommendation does not change.** Deprecate/unregister `policySmokeV1` in the same commit
as the encoder bump (Slice G, co-landed with Slice C), now priced against the full ledger above, with the
already-stored-warband caveat and the temporary Phase 3 DoD evidence gap both named explicitly and a tracked
follow-up issue recommended for a v2-trained replacement sample submission.

### Derived #70 split (S/M slices)

This table is written so #70's sub-issues can be filed directly from it:

**Corrected from the original split (round-1 tester review).** The original draft had a "B. Reuse-only Roles
+ Skills" slice that mixed the 2 new Roles with 2 of the 4 new Skills and marked it independent of Slice A
("can land in parallel ... needs no new primitive"). That was true for `RULESET_VERSION` but false for
`OBS_ENCODING_VERSION`, per the corrected analysis above: any of the 4 new Skills grows the catalog and
requires the encoder bump, so a Skills-containing slice cannot land as a self-contained, dependency-free
unit. The split below separates Roles (genuinely independent — Roles never touch `observation.ts`) from
Skills (which now carry the encoder migration as an inseparable part of the same slice, since the fixture
regeneration needs the *final* 10-entry catalog and doing it more than once per additional skill would be
wasted, duplicate work).

**Further corrected in this round (reviewer round 1, PR #140).** Three additional corrections, from a
substance-focused code review rather than a re-verification of survey numbers: (1) Slice A was mis-sized S
despite bundling three engine primitives (the augment schema/registry/application, a new status kind, and a
second new status kind) plus a `RULESET_VERSION` bump and golden regen — resized to M, matching Slices
C/D/F's own M sizing for comparable-or-smaller scopes; (2) the original Slice E ("extend the server's
build-acceptance schema to accept `augmentIds`") was based on a wrong premise — the server has no separate
acceptance schema, it reuses core's `WarbandSchema`/`parseWarband` directly (`packages/server/src/warbands/
routes.ts:1,32,130,186`, `matches/resolve.ts:2,54-55`), so a defaulted `augmentIds` field propagates for
free; Slice E is now round-trip/serialization verification instead of a schema extension; (3) the
`policySmokeV1` deprecation's true blast radius (see the full ledger and re-argued recommendation above) is
large enough to earn its own slice, G, rather than being an implicit footnote inside Slice C.

| Slice | Size | Scope | Blocked by |
|---|---|---|---|
| A. Engine primitives | M | Augment primitive (schema, registry, `UnitBuildSchema.augmentIds`, `init.ts` stat-delta application) **+** stun/root status kind **+** buff (haste/damage-up) status kind, added together to `vocab.ts`/the resolve step. One `RULESET_VERSION` bump (v2->v3), one golden-replay regen, one explanatory commit note. | none (first slice) |
| B. Reuse-only Roles | S | 2 new Roles (Skirmisher, Bulwark) as data-only additions; content-validation tests. Roles are never observation fields, so this slice touches neither `RULESET_VERSION` nor `OBS_ENCODING_VERSION`. | none — can land in parallel with A |
| C. Skill catalog + observation-encoder migration | M | All 4 new Skills (Piercing Shot, Battle Cry, Crippling Strike, Rally) added to `skills.ts` together, in the **same** commit as: the `OBS_ENCODING_VERSION` bump (v1->v2), the gym-side mirror update (`gym/warwright_gym/actions.py`'s `SKILL_CATALOG` list + its `OBS_ENCODING_VERSION` constant), and the fixture regenerations (`pnpm --filter @warwright/gym-bridge gen-fixture` -> `protocol_golden.json`; the TS `inference-parity.fixture.json`). Treated as **one atomic slice**, not split by Skill or split from the encoder bump: Crippling Strike and Rally need Slice A's new status kinds to exist as real (not placeholder) content, and the fixture regen needs the full, final catalog to avoid re-running it per Skill. **Must land in the same commit as Slice G**, not merely be blocked by it — `weights-schema.ts`'s module-load-time throw means a state that bumps `OBS_ENCODING_VERSION` without also retiring the still-v1-pinned `policySmokeV1` weights breaks the whole core package's build, so C and G cannot be sequenced as independently-mergeable PRs even though they are filed as separate sub-issues. | Blocked by: A |
| D. Augment content | M | 3 augment instances (Iron Plating, Swift Boots, Vital Surge) registered against the augment primitive. | Blocked by: A |
| E. Server round-trip / serialization verification | S | No server schema change needed (see the round-2 correction above): add an integration test proving a stored warband with non-empty `augmentIds` persists and returns intact through `POST -> GET -> PUT -> GET`, and confirm the jsonb column round-trips the array without special-casing, since both the write path (`routes.ts`) and match resolution (`matches/resolve.ts`) reuse core's `WarbandSchema`/`parseWarband` unmodified. | Blocked by: A |
| F. Web builder UI | M | Warband builder UI surface for selecting augments per unit. | Blocked by: A, D (needs real augment content to populate the picker) |
| G. `policySmokeV1` retirement (core + foundry ripple) | M | Per the full ledger above: remove the `policySmokeV1` named export and its `behaviorIds` entry (`index.ts`), its seed-registry registration (`seed-registry.ts`), its barrel export and test assertions (`content/behaviors/index.ts`/`.test.ts`), its dedicated match-integration test and demo build fixtures (`sim/policy-smoke-v1-match.test.ts`, `builds/policy-1v1-a.json`, `builds/policy-1v1-b.json`); retire the foundry `sample-policy` submission and its per-push CI gate line (`.github/workflows/ci.yml`), and update the 5 foundry test files that exercise it. Files a tracked follow-up issue to re-author a v2-trained exported-policy sample submission once one exists (out of this batch's scope — no retraining here). No server or web code change needed (same reuse reasoning as Slice E); confirm the already-stored-warband edge case is nil in the real `warbands` table before ratification. | Must co-land with C (see C's note); Blocked by: C |

**Wellspring boundary note.** #70 excludes the Wellspring objective (#71/#72); #71 is separately blocked by
#70. If Wellspring's channel-buff effect needs the same positive-buff status kind introduced in Slice A here
(haste/damage-up), #71 should **reuse** that status kind rather than defining its own — naming it once in
Slice A avoids two competing "buff" primitives shipping in the same phase. If Wellspring also introduces any
new Skill of its own, it inherits the same `OBS_ENCODING_VERSION` consideration described in Slice C above
(any catalog growth bumps the encoding) and should be priced by whoever specs #71/#72, not assumed free.

---

## 2. Visual-identity decision

### Recommendation

**Stay procedural. Recommend closing #74 as not-needed** at the next batch sign-off, rather than
implementing it behind the adapter.

### Rationale, grounded in the actual seam and the actual plan

`packages/web/src/assets/provider.ts` already implements exactly the adapter `docs/BUILD_PLAN.md` Section C
calls for: `proceduralProvider` is the only active provider, and `resolveAssetProvider(override) = override
?? proceduralProvider` is a pure, off-by-default selector — nothing changes unless something is explicitly
passed in. That seam is not in question here; #50 already built it correctly, and this decision does not
touch it.

What's in question is whether to *use* the seam now. BUILD_PLAN Section C's own case for procedural is not
just "it's free" — it is thematic: "the Familiars are constructs left by vanished Makers, so an abstract,
synthetic, geometric look reads as intentional." Introducing a curated CC0 sprite pack (Kenney.nl) for units
while ability icons and status indicators stay procedural risks a visually incoherent roster — geometric
procedural silhouettes next to pre-drawn sprite art — without any design pass to reconcile the two. No such
design pass is in scope for this spike (it would spend nothing but engineering time, and evaluating "does it
look coherent" honestly needs a human eye on mockups, not a text recommendation).

This run spends nothing, so "commission original art" can only ever be a recommendation for the human to
fund — that decision is explicitly **outside this spike's authority** and must go through `needs-human` at
ratification if the human wants to pursue it; this document does not price commissioned art, since pricing
it would require scoping a paid engagement, which is a funding decision, not a build decision.

The only zero-monetary-cost adoption path is the already-documented CC0/CC-BY set:
- **Kenney.nl** — CC0, no attribution required, for sprites/UI.
- **game-icons.net** — CC BY 3.0, **attribution required** if adopted, for ability icons. Recording this
  obligation here per the sub-plan: adopting any game-icons.net asset obligates a visible attribution
  (e.g., a credits section in the web client and/or a NOTICE file) naming the icon author and the CC BY 3.0
  license, since CC BY (unlike Kenney's CC0) is not license-free.

Since no coherence work has been done to show the CC0/CC-BY set actually reads well against the procedural
Familiar aesthetic, and since BUILD_PLAN Section C's own reasoning for procedural-as-primary is thematic
(not just cost), this recommendation is: don't spend the engineering effort on #74 without a concrete
signal that procedural visual density is actually a problem (e.g., post-launch player feedback). Procedural
remains both default and, per this recommendation, the **final** identity for this phase — not merely a
fallback awaiting a pack.

**AI-generated raster art stays out.** BUILD_PLAN Section C explicitly deferred it to "revisit only at
Phase 4" — this document is that revisit, and it does not affirmatively show style coherence across a
roster or a clear licensing story solved; per the #139 guardrail (no AI raster art without solved coherence
and licensing), it is not recommended.

### Consequence for #74

**Recommend: close #74 as not-needed** at the next batch sign-off (matching #74's own stated non-goal:
"Skip entirely if Gate 4 (#69) chose to stay procedural"). If the human ratifying this decision instead
wants the curated CC0/CC-BY set implemented, #74 should be reopened/relabeled as
implement-behind-adapter rather than closed, using the AssetProvider seam exactly as documented (procedural
staying the default and fallback even if a pack is added), and the game-icons.net attribution obligation
above must be honored in that implementation. If the human wants commissioned art, that is a separate,
funded, `needs-human` decision outside the scope of any existing scouted issue and is not evaluated further
here.

---

## Guardrail checklist (batch #139)

- [x] No art commissioned by this spike.
- [x] Nothing spent (no packages installed, no assets bundled, no money committed).
- [x] Procedural stays the default (and, per this recommendation, stays the identity outright).
- [x] Any future art arrives only through the `AssetProvider` adapter, never coupled to game/render logic.
- [x] Engine primitives (augments, stun/root, buff status) are added only when truly needed for the
      proposed batch, each with an explicit `RULESET_VERSION` bump and golden-replay regen plan.
- [x] No pay-to-win: augments are init-time build choices validated the same as Roles/Skills, not a
      purchasable power source — this spike proposes no economy or purchase mechanism at all.
- [x] No AI-generated raster art recommended (coherence and licensing not shown to be solved).
- [x] `OBS_ENCODING_VERSION` impact explicitly checked and stated: **the batch DOES require a bump, v1 -> v2**
      (the augment primitive alone does not, but the 4 new Skills grow the skill catalog and widen
      `OBS_SELF_FIELD_COUNT` from 11 to 15 — a breaking layout change per `observation.ts`'s own header
      contract), with the resulting ripple onto `policySmokeV1` priced against its full ledger (core's public
      API and `behaviorIds`, the seed registry, the behaviors barrel and its test, the match-integration test
      and its build fixtures, and the entire foundry surface including its per-push CI gate) — **recommended:
      deprecate/unregister in the same commit as the encoder bump (Slice G, co-landed with Slice C)**, not
      re-export or re-train inline, and not a frozen per-policy encoder shim (evaluated, deferred to its own
      follow-up spike). The already-stored-server-warband edge case and the temporary Phase 3 DoD
      exported-policy evidence gap are both named explicitly above, with a tracked follow-up issue recommended
      for a v2-trained replacement sample submission, rather than left unstated.

## Outputs are recommendations only

Everything above — the content-batch scope, the augment primitive definition, the #70 split, and the
visual-identity decision — is a **recommendation pending human ratification at the next batch sign-off**
(the #139 guardrail). No engine, content, or art change is authorized by this document.
