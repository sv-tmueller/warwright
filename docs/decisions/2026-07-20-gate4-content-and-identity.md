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
support pattern, and stat-modifying loadout choices) instead of only recombining existing primitives.

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

Items 5, 6, and 7-9 all land under **one** `RULESET_VERSION` bump and **one** golden-replay regeneration if
sequenced as a single engine-primitives commit (see the #70 split below) — bumping once for a batch of
primitives is preferable to bumping once per primitive, since each bump forces a full re-validation pass and
an explanatory note; batching the explanation once is clearer than three near-duplicate notes.

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

**Is `OBS_ENCODING_VERSION` affected? No — and this must be stated explicitly, not assumed.**
`observation.ts`'s self-block encodes `hp`, `maxHp`, `pos.x/y`, `attackCooldownRemaining`, and one
cooldown slot per catalog Skill; the per-unit block encodes `id`, `hp`, `maxHp`, `pos.x/y`, and squared
distance. Augments apply init-time deltas to `Unit.maxHp`/`hp`/`armor`/`moveSpeed`, and of those, only
`hp`/`maxHp` are ever read by the encoder — as *values*, not as a new field. An augmented unit's `hp`/`maxHp`
just carry different (still integer) numbers through the same slots; the field order, field count, and the
per-skill cooldown layout are all unchanged. `armor` and `moveSpeed` are not observation fields at all
today, so augmenting them changes nothing about the encoder's layout either. **Conclusion: the augment
primitive requires a `RULESET_VERSION` bump but requires no `OBS_ENCODING_VERSION` bump and no change to
`observation.ts`.**

### Derived #70 split (S/M slices)

This table is written so #70's sub-issues can be filed directly from it:

| Slice | Size | Scope | Blocked by |
|---|---|---|---|
| A. Engine primitives | S | Augment primitive (schema, registry, `UnitBuildSchema.augmentIds`, `init.ts` stat-delta application) **+** stun/root status kind **+** buff (haste/damage-up) status kind, added together to `vocab.ts`/the resolve step. One `RULESET_VERSION` bump (v2->v3), one golden-replay regen, one explanatory commit note. | none (first slice) |
| B. Reuse-only Roles + Skills | M | 2 new Roles (Skirmisher, Bulwark) + 2 reuse-only Skills (Piercing Shot, Battle Cry) as data-only additions; content-validation tests. | none — can land in parallel with A, since it needs no new primitive |
| C. New-primitive Skills | M | Crippling Strike (stun/root) + Rally (buff) as data using the new status kinds. | Blocked by: A |
| D. Augment content | M | 3 augment instances (Iron Plating, Swift Boots, Vital Surge) registered against the augment primitive. | Blocked by: A |
| E. Server build-snapshot ripple | S | Extend the server's build-acceptance schema/validation to accept `augmentIds`. | Blocked by: A |
| F. Web builder UI | M | Warband builder UI surface for selecting augments per unit. | Blocked by: A, D (needs real augment content to populate the picker) |

**Wellspring boundary note.** #70 excludes the Wellspring objective (#71/#72); #71 is separately blocked by
#70. If Wellspring's channel-buff effect needs the same positive-buff status kind introduced in Slice A here
(haste/damage-up), #71 should **reuse** that status kind rather than defining its own — naming it once in
Slice A avoids two competing "buff" primitives shipping in the same phase.

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
- [x] `OBS_ENCODING_VERSION` impact explicitly checked and stated (not affected).

## Outputs are recommendations only

Everything above — the content-batch scope, the augment primitive definition, the #70 split, and the
visual-identity decision — is a **recommendation pending human ratification at the next batch sign-off**
(the #139 guardrail). No engine, content, or art change is authorized by this document.
