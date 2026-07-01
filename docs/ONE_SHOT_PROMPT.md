# Warwright, the one-shot prompt

This is the single-paste kickoff prompt for building Warwright in one autonomous run, optimized for first-try success. It differs from the gated master prompt in `BUILD_PLAN.md` Section D in three ways:

1. **No human gates.** Phase gates become self-gates: the run may not advance until that phase's Definition of Done commands actually pass, executed by the agent itself.
2. **Every open decision is pre-made.** Ambiguity is the main one-shot killer, so every "or" in the build plan (React or Preact, tsup or tsc, hash algorithm, arena size) is resolved in the prompt.
3. **The known determinism traps are named up front.** The failure modes that break a golden-replay test on the first try (RNG draw order, unstable serialization, floating-point drift, tie-breaking) are called out as explicit requirements, not left to be discovered in debugging.

## Scope: why Phase 0 + Phase 1

A one-shot run should cover exactly what a single session can build **and objectively verify** with no external infrastructure. Phase 0 (deterministic core + CLI) and Phase 1 (browser sandbox) are pure TypeScript, need no database, no Docker, no accounts, and have machine-checkable Definitions of Done. Phase 2 onward needs PostgreSQL, auth decisions, and Python — those warrant a human at the gate and are deliberately excluded. The run ends with a working game you can play in the browser, backed by green determinism and parity tests.

## How to launch

- Start the session on the strongest model at maximum effort: `claude --model opus`, then `/effort max`. (On Team Standard the default model is Sonnet; do not trust Default.)
- Leave `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_EFFORT_LEVEL` unset so the per-role subagent split in `CLAUDE.md` holds (Sonnet generation, Opus review).
- Paste the prompt below as the first and only message. Intervene only if the run stops and asks.

## The prompt

```
ultrathink

You are a senior game-engine and TypeScript architect who builds deterministic simulation cores and the pure-view clients on top of them. You write small, legible, well-tested code, and you are ruthless about determinism.

MISSION
Build Warwright Phase 0 (deterministic core + CLI) and Phase 1 (browser sandbox), end to end, in this one run. docs/BUILD_PLAN.md in this repository is the complete specification: read Sections B, C, E, and F in full before writing any code. CLAUDE.md holds the house rules; every rule in it is binding. Phases 2-4 are OUT OF SCOPE: no server, no database, no auth, no Python, no networking, no deployment.

PRIME DIRECTIVE
Given the same inputs (ruleset version, seed, warband A, warband B), runMatch must produce a byte-identical event log on every machine and every run, and the CLI and the browser client must derive their entire output from that log. Everything else is negotiable; this is not.

PRE-MADE DECISIONS (do not re-litigate, do not ask)
- Package manager: pnpm workspaces. Node 20 LTS, pinned in .nvmrc and in CI.
- Packages: @warwright/core, @warwright/cli, @warwright/web. Core's only runtime dependency is Zod.
- Build: tsup for core and cli; Vite for web. Vitest everywhere. ESLint flat config + Prettier.
- Web UI: React 18 + Canvas 2D. No Three.js, no WebGL, no CSS framework.
- PRNG: mulberry32, integer ops with >>> 0, one stream per match, seeded from the match seed.
- Event-log hash: FNV-1a 32-bit implemented in plain TypeScript inside core (crypto is forbidden in sim/), computed over a stable stringify with recursively sorted object keys. Export both stableStringify and hashEventLog from core so CLI, web, and tests all use the same functions — never a second implementation.
- Arena: integer grid, 200 x 120. Positions, ranges, and speeds are integers; range checks compare squared distances.
- Ruleset version: "0.1.0", a constant in core, included in every MatchResult and in the replay tuple.
- Content v0: 4 Roles (Bulwark: tanky frontline; Lens: ranged controller; Sever: burst melee; Mender: healer), 7 Skills wired to those roles, 3 Behaviors (aggro-lowest-hp, protect-allies, focus-casters). Two sample warbands in builds/warband-a.json and builds/warband-b.json.

DETERMINISM TRAPS — get these right the first time, they are where golden-replay tests die:
1. RNG draw order is part of the spec. Process units in ascending unit id every tick; every RNG draw happens inside that iteration order. Never draw from the RNG in a callback, a sort comparator, or event emission.
2. All ties break deterministically by lowest unit id (target selection, equidistant candidates, simultaneous deaths). No tie may ever be resolved by iteration order of a Map/Set or object keys — iterate sorted arrays.
3. The event log is the only output. Every state change (move, attack, cast, damage, heal, status apply/expire, death, match end) emits a typed event carrying the tick. Renderers and the CLI never read sim internals.
4. No floats in sim state. Integer position, hp, damage, cooldown-in-ticks. Accumulate fractional movement as integer remainders (Bresenham-style stepping), never as floats.
5. Seeking in the viewer means replaying events from tick 0 up to the target tick into a fresh view state. Never simulate backwards, never mutate incrementally on seek.
6. Enforcement is mechanical, not conventional: an ESLint no-restricted-globals/no-restricted-imports override scoped to sim/ forbidding Math.random, Date, performance, crypto, Node builtins, and DOM globals, PLUS a test that scans sim/ sources for those tokens, PLUS a lint rule or test that web never imports core's internal sim resolve modules — only the public API.

ORDER OF WORK
0. Read docs/BUILD_PLAN.md Sections B, C, E, F and CLAUDE.md. Then write a short plan: the file tree and the order of work, including where each determinism rule is enforced. Commit nothing yet.
1. Monorepo scaffolding: pnpm workspace, tsconfig (strict, no exceptions), ESLint + Prettier including the sim/ determinism override, .nvmrc, CI workflow (install, typecheck, lint, test).
2. Core sim: PRNG, tick loop at TICK_HZ = 20, state types, movement, combat resolution (damage, armor, cooldowns, statuses: slow, shield, damage-over-time), win/loss detection, event log, stableStringify + hashEventLog, runMatch(version, seed, warbandA, warbandB).
3. Content layer: Zod schemas for Role/Skill/Warband, the Behavior interface and registry, the 4 Roles / 7 Skills / 3 Behaviors, the two sample warbands, loud failure on invalid data or unknown ids.
4. api/ interfaces for the future server and gym — types only, no implementation.
5. CLI: sim:run --seed --a --b prints a tick-by-tick log and the winner, derived only from the event log.
6. Tests, then SELF-GATE 0: golden-replay test (fixed seed + builds → hash equals committed snapshot, and two fresh runs are deep-equal), engine behavior tests, content-validation tests, the sim/ purity scan. Run the full Phase 0 Definition of Done from Section E — pnpm install, pnpm -r typecheck, pnpm -r lint, pnpm -r test, and the CLI run twice with identical output — and iterate until every command passes. Do not proceed on red.
7. Web package: warband builder (validated live with core's Zod schemas, import/export the same warband JSON the CLI uses, localStorage persistence), match viewer (runs core.runMatch, plays back the event log on canvas: movement, attacks, casts, damage, deaths, hp/resource bars, status indicators, scrolling event feed; play/pause, speed, exact seek by tick, single-step), procedural art only (color+shape encode Role, size encodes hp, ability icons deterministic from skill id), the AssetProvider interface with the procedural implementation as default and no bundled assets.
8. Parity test: for a fixed seed and the sample builds, the web path's winner and event-log hash equal core.runMatch and the CLI. This test uses the exported hashEventLog — if it fails, a surface diverged; fix the surface, never the test.
9. SELF-GATE 1: run the full Phase 1 Definition of Done from Section F and iterate until green. Verify pnpm build emits a static bundle and pnpm dev serves the app.
10. Final self-review pass: re-read CLAUDE.md top to bottom and check the finished tree against every rule. Confirm no TODO/FIXME/stub/placeholder exists in any core path (grep for them). Update README status from "scaffolding only" to reflect what now exists.

QUALITY BARS
- Real, working code everywhere. No TODOs, stubs, dead flags, or placeholder logic in core paths.
- Never weaken, skip, or delete a test to get to green. If the golden-replay hash changes because you intentionally changed rules during this run, regenerate the snapshot in the same commit with a note — after this run it requires a ruleset version bump.
- Validate all external data (warband files, builder input) with Zod and fail loud with actionable messages.
- Small pure functions in resolve/. TypeScript strict with zero suppressions; no `any`, no `@ts-expect-error` in sim/.
- Commit in logical, reviewable chunks with clear conventional messages, roughly one commit per step above.
- Route changes through the code-reviewer subagent per CLAUDE.md before considering a step done.

FINISH
Report: what was built, the key files, how each determinism guarantee is mechanically enforced (rule → lint/test that enforces it), the golden-replay hash, proof both self-gates passed (the exact commands and their results), and any assumptions made. Then stop. Do not begin Phase 2.

STOP AND ASK only if a decision would change the determinism contract, the parity requirement, or the public API shape that Phases 2-4 depend on. Everything else: decide, note it in the final report, and keep moving.
```

## Why this maximizes one-shot success

| Lever | Where it lives in the prompt |
| --- | --- |
| No decision stalls | PRE-MADE DECISIONS resolves every "or" in the spec, and STOP AND ASK is narrowed to contract-breaking questions only |
| Objective verification | Self-gates 0 and 1 require the actual Definition of Done commands to pass before advancing; "do not proceed on red" |
| The likely bugs are pre-empted | DETERMINISM TRAPS names the five classic golden-replay killers (draw order, tie-breaks, float drift, unstable serialization, seek-by-mutation) as requirements |
| One implementation of shared logic | stableStringify/hashEventLog are exported from core and mandated everywhere, so parity can't fail from duplicate hashing code |
| No test-gaming escape hatch | "fix the surface, never the test" and "never weaken a test to get to green" close the two ways agents fake green |
| Plan before code | Step 0 forces a file tree and enforcement map before the first commit |
| Context survives | The contract is restated inline, so it holds even if spec reading is shallow; BUILD_PLAN.md sections are still mandated reading |
| Scope can't creep | Phases 2-4 declared out of scope twice (mission and finish), with an explicit "do not begin Phase 2" |
