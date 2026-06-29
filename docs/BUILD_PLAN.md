# Warwright, Master Build Plan and Claude Code Prompts (Phases 0 to 4)

This is the complete, self-contained brief for building Warwright, an autobattler. Hand this one file to Claude Code, kick off once, and intervene only at the phase gates.

Warwright is original IP. It borrows the architecture of World of Claudecraft (one deterministic core reused across runtimes), not its assets or lore. No tokens, no web3; cosmetics only, much later.

Contents:
- Section A, how to run this (model, effort, orchestration, subagent routing, gates)
- Section B, shared architecture and the determinism contract (the invariant across all phases)
- Section C, asset strategy
- Section D, the master kickoff prompt
- Section E, Phase 0 specification (deterministic core)
- Section F, Phase 1 specification (playable browser sandbox)
- Section G, Phase 2 specification (authoritative server and ranked ladder)
- Section H, Phase 3 specification (training environment and Foundry)
- Section I, Phase 4 specification (content depth, modes, identity, cosmetics)
- Section J, the consolidated CLAUDE.md

---

## Section A. How to run this

### The configuration (your own orchestrator)
Run the build through your claude-template orchestrator, not ultracode's automatic fan-out. The reasoning: ultracode forces an all-or-nothing worker model (all Opus, which is limit-risky over hours, or all Sonnet via the global env var, which also forces the reviewer to Sonnet and thins the verifier). Your orchestrator is the only setup that runs code generation cheaply on Sonnet while keeping the reviewer on Opus, which is the right division of labor for a correctness-critical, multi-hour run.
- **Orchestrator (the planning and routing loop):** Opus 4.8 at max effort. It holds the architecture, plans the work, and delegates per role.
- **Code generation workers:** Sonnet 4.6 subagents (effort omitted, so high, which is Sonnet's effective top tier for coding). This keeps the bulk token volume off Opus and protects your usage limits.
- **Code reviewer and verifier:** an Opus 4.8 subagent at effort max with read-only tools. Keeping the critic on the strong model is what preserves the verification quality that long autonomous runs depend on.
- **Do not set CLAUDE_CODE_SUBAGENT_MODEL.** It sits at the top of the model-resolution order and would override the per-role frontmatter, forcing every subagent (reviewer included) to one model. The global env var and the per-role split are mutually exclusive; here you want the per-role frontmatter.
- **Leave ultracode off in this mode.** Ultracode is itself an orchestrator (xhigh plus automatic dynamic workflows), so running it on top of your orchestrator means two orchestration layers competing. Keep ultracode for separate, bounded, hands-off sessions (a codebase-wide sweep, a gnarly bug), not for this build.

### Per-role model and effort (how the split is expressed)
Model and effort are per-subagent frontmatter fields, resolved in this order: the CLAUDE_CODE_SUBAGENT_MODEL env var (leave unset), then a per-invocation parameter, then frontmatter, then the main model. Define at least two subagents in your harness:
- code-generator: model sonnet, write tools. Implements well-specified tasks from the plan.
- code-reviewer: model opus, effort max, read-only tools (Read, Grep, Glob), with a strong "use proactively after any code change" description. Reports issues by severity with file and line references, suggests minimal fixes, and does not modify files.

Drive the routing deterministically through your /tm- orchestration: delegate implementation to code-generator and route every change through code-reviewer before a task counts as done. Agent teams, or an explicit @-mention of the reviewer, both guarantee the reviewer actually runs on Opus. Note that even with these definitions, an automatic ultracode workflow is not guaranteed to map its workers onto your named subagents, which is the other reason this mode uses explicit orchestration rather than auto-fan-out.

### Your /tm- agents (mapped for this repo)
The claude-template orchestrator is already wired through global role agents and tm- skills, so nothing needs installing into this repo. The build plan's two named subagents map onto existing role agents:

- code-generator -> the `developer` agent (model: sonnet, write tools). Implements one issue end to end in an isolated worktree, with TDD and conventional commits.
- code-reviewer -> the `reviewer` agent (model: opus, read-only: Read, Grep, Glob). Two-pass review (spec compliance, then code quality) returning APPROVE or CHANGES_REQUESTED with file:line findings. Never edits.

Two more role agents round out the loop:
- `architect` (model: opus, read-only): sub-plans, split proposals when an issue is mis-sized, and arbitration when developer and reviewer disagree.
- `tester` (model: sonnet, read-only): independent verification on the branch. Runs the full check suite (including the golden-replay and cross-surface parity gates) and tries to break the change.

Orchestration commands (all global, user-typed):
- `/tm-kickoff <issues>` dispatches a phase's decomposed issues through the per-package developer -> tester -> reviewer pipeline, at most 3 concurrent. The lead session (this orchestrator, Opus 4.8) routes every handoff; merging and the phase gate stay human.
- `/tm-to-issues` turns an approved phase plan into sized issues; `/tm-grill-me` stress-tests a phase plan before slicing.

Per phase: kick off the orchestrator, have it restate the phase and write the file tree and order of work first (per the master kickoff prompt below), decompose that phase into size:S/size:M issues, then run them through `/tm-kickoff`. CLAUDE_CODE_SUBAGENT_MODEL stays unset so the per-role model split (sonnet generation, opus review) holds.

### Set it deterministically (do not rely on the UI toggle)
For an unattended run:
- Launch the orchestrator on Opus 4.8 explicitly (on Team Standard the Default is Sonnet, so do not trust Default): claude --model opus, then set effort to max with /effort (a session setting, not the env var).
- Leave both CLAUDE_CODE_SUBAGENT_MODEL and CLAUDE_CODE_EFFORT_LEVEL unset, so per-subagent frontmatter model and effort are honored. The effort env var would override frontmatter effort, including the reviewer's max.
- Put all house rules and skill-trigger cues in CLAUDE.md (Section J) so every subagent inherits them.
- Optionally add the keyword ultrathink in the kickoff message to deepen the first planning turn.

### Fallback: ultracode with Sonnet workers
If your orchestrator turns out to lack a real plan, execute, verify loop with a reviewer that gates progress, switch to ultracode instead: run the orchestrator on Opus 4.8 with ultracode and set CLAUDE_CODE_SUBAGENT_MODEL=sonnet. You lose the per-role split (all workers become Sonnet, reviewer included), but you gain Claude Code's engineered fan-out, which is more robust for unattended runs than a weak custom harness. In this mode, lean hard on the tests as the safety net.

### Tests are the real safety net
In either mode, make the golden-replay test and the cross-surface parity test mandatory gates that must pass before a task is considered done. They are objective ground truth, so they catch drift that a weak auto-verifier or a Sonnet reviewer would miss. This matters more than which harness orchestrates.

### Decision gates (intervene only here)
Decide model, effort, orchestration, and asset strategy once at the start. After that, step in only at these gates, which double as the phase boundaries:
- Gate 0: Phase 0 Definition of Done passes (deterministic core, golden-replay test green).
- Gate 1: Phase 1 Definition of Done passes (a match plays back in the browser, parity with the CLI).
- Gate 2: Phase 2 Definition of Done passes (a ranked match resolves server-side and verifies).
- Gate 3: Phase 3 Definition of Done passes (a deterministic gym env trains a policy that exports to a TypeScript Behavior, and the Foundry gates submissions).
- Gate 4: Phase 4 Definition of Done passes (content depth merged with a ruleset version bump, a new mode is playable, and no cosmetic touches the sim).
Between gates, hands-off.

---

## Section B. Shared architecture and the determinism contract

One deterministic core is the single source of truth. runMatch(version, seed, warbandA, warbandB) returns a MatchResult containing a structured event log. Same inputs, identical log, on every machine and every run. Every runtime (CLI, browser, server, future gym) wraps this core and never re-implements combat. This buys trivial replays (store a seed plus two builds), exact seeking, reproducible balance debugging, server-side anti-cheat by re-running, and a ready-made training environment later.

The determinism contract, enforced by lint and tests, holds in every phase:
1. packages/core/src/sim imports nothing from Node, the DOM, the network, or any rendering library. It is pure computation.
2. All randomness flows through one seeded PRNG (mulberry32, integer operations, applied with >>> 0). Math.random, Date, Date.now, performance.now, and crypto are forbidden anywhere under sim/.
3. Time is integer ticks at TICK_HZ = 20 (DT = 1/20 s). Cooldowns, durations, and regen are integers in ticks. No wall-clock time in the sim.
4. Combat math is integer where possible. No Math.sqrt or trigonometry in the sim; compare squared distances. Avoid Math.fround and any platform-variant function.
5. Units are processed each tick in a fixed order (ascending unit id). Every RNG draw happens in that order.
6. A replay is exactly { version, seed, buildA, buildB } and reproduces the full match.
7. Cross-surface parity: for a fixed seed and the same builds, the CLI, the browser client, and the server must all produce the same winner and the same stable hash of the event log. A parity test guards this and must always pass; if it fails, a surface diverged and must be fixed, not the test.

A key insight that scopes Phase 2: an autobattler match takes no per-tick player input during combat. A match is fully determined by the two builds plus a seed, so the server simply runs the core to completion. There is no real-time netcode, no client prediction, no lag compensation. The server owns every roll by construction.

---

## Section C. Asset strategy

**Primary: procedural and self-generated.** Draw everything on canvas at runtime, as World of Claudecraft did. It is deterministic-friendly, license-free, keeps the open-source repo free of binary assets, and is thematically coherent: the Familiars are constructs left by vanished Makers, so an abstract, synthetic, geometric look reads as intentional. Units are distinct geometric silhouettes per Role (color and shape encode Role, size encodes hp, a simple rigged pose plays on attack and cast). Ability icons are painted procedurally and deterministically from the skill id.

**Fallback (documented, off by default): freemium CC0.** For a fast visual uplift later without an art pipeline: Kenney.nl (CC0, no attribution) for sprites and UI, and game-icons.net (CC BY 3.0, attribution) for ability icons. Add only through a thin AssetProvider adapter, never by coupling art to game or render logic. Do not bundle third-party assets during the build phases.

**Not now: AI-generated raster art.** Style coherence across a roster is hard and the licensing is murkier than CC0. Revisit only at Phase 4.

Hard rule: assets and art carry no game logic. Renderers are pure views over the event log.

---

## Section D. The master kickoff prompt

Save this document in the repo as docs/BUILD_PLAN.md so the orchestrator and its subagents can read it. Then start your claude-template orchestrator on Opus 4.8 at max effort, with code-generator subagents on Sonnet and the code-reviewer subagent on Opus at max effort, and CLAUDE_CODE_SUBAGENT_MODEL left unset (see Section A). Paste the block below.

```
ultrathink

You are building Warwright, an autobattler, following docs/BUILD_PLAN.md in this repository as the complete specification. Read it in full before doing anything.

Build it in five phases, in order: Phase 0 (deterministic core), Phase 1 (browser sandbox), Phase 2 (authoritative server), Phase 3 (training environment and Foundry), then Phase 4 (content depth, modes, identity, cosmetics). Each phase has its own specification section and its own Definition of Done.

Rules for the whole run:
- Obey the shared determinism contract and the parity requirement in every phase. They are enforced by lint and tests, not by convention.
- At the start of each phase, restate your understanding and write a short build plan (file tree and order of work) before coding. Think hard about determinism, the RNG stream order, and cross-surface parity, and call out edge cases.
- Implement in logical, reviewable commits with clear messages. Write real, working code: no TODOs, stubs, or placeholder logic in core paths.
- At the end of each phase, run that phase's Definition of Done commands yourself, iterate until they all pass, then STOP and report results. Do not start the next phase until I approve.
- Stop and ask mid-phase only if a decision would change the architecture or the determinism and parity contract.

Begin with Phase 0.
```

---

## Section E. Phase 0 specification, deterministic core

```
ROLE
You are a senior game-engine and TypeScript architect. You build deterministic simulation cores that run unchanged in a browser, on an authoritative Node server, and inside a headless reinforcement-learning environment. You write small, legible, well-tested code, and you are ruthless about determinism.

GOAL
Build only the deterministic core and its tooling for Warwright. Do not build the server, the browser UI, or the gym in this phase.

PRIME DIRECTIVE, DETERMINISM
Given the same inputs (ruleset version, seed, warband A, warband B), runMatch MUST produce a byte-identical event log on every machine and every run. Make it mechanical:
- packages/core/src/sim imports nothing from Node, the DOM, the network, or any rendering library.
- All randomness flows through one seeded PRNG (mulberry32, integer operations, >>> 0). Math.random, Date, Date.now, performance.now, and crypto are forbidden under sim/. Add an ESLint no-restricted-globals and no-restricted-imports override scoped to sim/ that fails the build on violation, and a test that scans sim/ source for these tokens.
- Time is integer ticks at TICK_HZ = 20 (DT = 1/20 s). Cooldowns, durations, and regen are integers in ticks.
- Combat math is integer where possible. No Math.sqrt or trig in sim/; compare squared distances. Avoid Math.fround.
- Units are processed each tick in ascending unit id order; all RNG draws happen in that order.
- A replay is exactly { version, seed, buildA, buildB }.

SCOPE, v0 WALKING SKELETON
In scope:
1. A pnpm monorepo with one library package @warwright/core and one thin CLI package @warwright/cli.
2. The deterministic battle engine: state types, the seeded PRNG, the tick loop, combat resolution (damage, armor reduction, cooldowns, a small set of status effects such as slow, shield, and damage-over-time), simple 2D movement on an integer arena (straight line toward target, clamped to bounds; melee versus ranged decided by squared distance), win and loss detection, and a structured event log where every state change emits an event.
3. A content model as data-as-code: Roles and Skills defined as data validated by Zod schemas; Behaviors implemented as small TypeScript modules behind a Behavior interface and registered by id. A registry that loads and validates all content and fails loud on bad data or an unknown id.
4. Seed content: at least 4 Roles (a tanky frontline, a ranged controller, a burst melee, a healer), 6 to 8 Skills wired to those roles, and 3 rule-based Behaviors (for example aggro-lowest-hp, protect-allies, focus-casters). Two sample warband JSON files in builds/.
5. A CLI command that runs a match from a seed and two warband files and prints a readable tick-by-tick log plus the winner. Output must derive only from the event log.
6. Documented TypeScript interfaces in packages/core/src/api for the future server and gym (the shapes they will implement). Define them, do not implement them.
7. Vitest tests: a golden-replay determinism test (run a fixed seed and builds, stable-stringify the event log with sorted keys, hash it, assert it equals a committed snapshot, and assert two runs are deep-equal), an engine behavior test, and a content-validation test.
8. Tooling: TypeScript strict, ESLint and Prettier (including the sim/ determinism override), a .nvmrc pinned to Node 20 LTS, and a GitHub Actions workflow running install, typecheck, lint, and test.
9. Docs: a README and the CLAUDE.md from Section J of the build plan.

Out of scope: multiplayer server, database, accounts, any web or canvas UI, the Python gym, networking, crypto or tokens, art assets, deployment.

TECH
TypeScript (strict), pnpm workspaces, Vitest, Zod, ESLint and Prettier, tsup or tsc for build, Node 20 LTS. No runtime dependency in core beyond Zod.

DEFINITION OF DONE
From a clean clone, all succeed:
- pnpm install
- pnpm -r typecheck with zero errors
- pnpm -r lint with zero errors, including the sim/ determinism rule
- pnpm -r test with all tests green, including the golden-replay determinism test
- pnpm sim:run --seed 42 --a builds/warband-a.json --b builds/warband-b.json prints a tick-by-tick log and a winner, identical on a second run
Finish with a short summary: what you built, the key files, the determinism guarantees and how they are enforced, and any decisions or assumptions.
```

---

## Section F. Phase 1 specification, playable browser sandbox

```
ROLE
You are a senior frontend and game-client engineer. You build deterministic-replay viewers and tool UIs on top of existing engines. You never re-implement game logic in the client; the client is a pure view over the engine's output.

CONTEXT
@warwright/core from Phase 0 exists, exposing runMatch, the state and event types, the Zod content schemas, and the content registry. Build the browser client: a warband builder and a match viewer that plays back the event log. Fully client-side. No server, no network.

PRIME DIRECTIVE, PURE VIEW AND PARITY
- requestAnimationFrame drives rendering only. The sim is fixed 20 Hz and authoritative. Frame timing never feeds back into sim state. Interpolation is cosmetic and never changes an engine value.
- Import core's public API and reuse core's Zod schemas to validate builds. Do not redefine game types in the client.
- Determinism parity: for a fixed seed and the same builds, the client's winner and event-log hash must equal core.runMatch and the Phase 0 CLI. Add a test asserting this.

SCOPE, v1 PLAYABLE SANDBOX
In scope:
1. A Vite + TypeScript app as a new package packages/web, depending on @warwright/core through the workspace. React (or Preact) for UI, Canvas 2D for the arena. No Three.js or WebGL.
2. Warband builder: pick a Role per unit, slot Skills (respecting slots), choose a Behavior, set start positions. Validate live against core's schemas and surface errors loudly. Export and import the same warband JSON the CLI uses. Persist builds locally (localStorage or file download and upload).
3. Match viewer: choose a seed and two warbands (built or loaded from builds/), run core.runMatch, and play back the event log on the canvas: movement, attacks, casts, damage, deaths, health and resource bars, status indicators. Include a scrolling event feed and controls: play and pause, speed, scrub and seek by tick, single-step. Seeking to any tick must be exact.
4. Procedural art, default path: draw everything on canvas at runtime. Units are geometric construct silhouettes per Role (color and shape encode Role, size encodes hp, a rigged pose plays on attack and cast). Ability icons painted deterministically from the skill id. Arena, bars, indicators, and particles drawn in code. Clean HUD typography. No external image files in the default path.
5. Asset adapter, documented and off by default: a thin AssetProvider interface so a CC0 pack can drop in later without touching render or game logic. Provide the procedural implementation as default. Document, do not bundle, Kenney.nl (CC0) and game-icons.net (CC BY 3.0).
6. Tooling: extend ESLint, Prettier, tsconfig. Add a lint rule or test that the client never imports core's internal sim resolve modules directly. Wire typecheck, lint, and test into the root scripts and CI. pnpm build emits a static bundle hostable anywhere.
7. Docs: update README and CLAUDE.md (the pure-view rule, art conventions, the parity requirement).

Out of scope: any server, accounts, networking or real-time multiplayer, the Python gym, AI-generated assets, deployment, tokens or economy. Sound is optional, limited to simple WebAudio blips if time allows.

TECH
Vite, TypeScript strict, React or Preact, Canvas 2D, @warwright/core and its Zod schemas reused, Vitest (jsdom or a headless run for the parity test). Minimal dependencies.

DEFINITION OF DONE
From a clean clone, all succeed:
- pnpm install; pnpm -r typecheck; pnpm -r lint; pnpm -r test all green, including the determinism parity test against core.runMatch
- pnpm dev launches the app; you can build two warbands (or load the samples), pick seed 42, run a match, and watch full playback with working play, pause, speed, seek, and step controls
- the same seed and builds produce identical playback and the same winner as the Phase 0 CLI
- all art is procedural and no third-party asset files are bundled
- pnpm build emits a static, hostable bundle
Finish with a short summary: files, the pure-view and parity guarantees and how enforced, the procedural-art approach, and any decisions.
```

---

## Section G. Phase 2 specification, authoritative server and ranked ladder

```
ROLE
You are a senior backend engineer who builds authoritative game services and competitive ladders. You treat the server as the single source of truth, you reuse the existing deterministic core rather than re-implementing rules, and you are conservative and standards-based about authentication and data integrity.

CONTEXT
@warwright/core from Phase 0 runs on the server unchanged, the same TypeScript package. Because an autobattler match takes no per-tick player input, a match is fully determined by two builds plus a seed. The server therefore resolves a match by running core.runMatch to completion. There is no real-time netcode, no client prediction, no lag compensation. Build the authoritative server, ranked matchmaking, persistence, and the client integration for online play. Keep the Phase 1 offline mode fully working.

PRIME DIRECTIVE, SERVER AUTHORITY AND REPRODUCIBILITY
- The server is the only place a ranked match is resolved. Clients submit intent (their build); they never compute outcomes.
- Every match is reproducible from { version, seed, buildA snapshot, buildB snapshot }. Persist those plus the winner and a stable result hash and the engine ruleset version. Snapshot the builds at match time so later edits do not change history.
- Cross-surface parity holds: the server's winner and result hash for given inputs equal the CLI and the browser client. Extend the parity test to the server path. Refuse to compare results across differing ruleset versions; re-run a stored match under its recorded version.

SCOPE, v2 AUTHORITATIVE SERVICE
In scope:
1. A new package packages/server: a Fastify + TypeScript service depending on @warwright/core. PostgreSQL via Drizzle ORM with drizzle-kit migrations. Validate all request bodies with Zod, reusing core's schemas for builds. (Prisma is an acceptable alternative to Drizzle; pick one and note it.)
2. Accounts and auth: register, login, logout, and session management. Hash passwords with argon2id. Use signed httpOnly session cookies (or JWT) with CSRF protection for cookie auth, and rate-limit auth endpoints. Use vetted libraries; do NOT hand-roll cryptography or session logic.
3. Warband persistence: CRUD for a user's saved warbands, validated against core's schemas; reject illegal builds.
4. Matchmaking and ranked resolution: a queue endpoint that pairs players by rating; on a pairing, the server picks a seed, snapshots both builds, runs core.runMatch, persists the match (inputs, winner, result hash, ruleset version), updates ratings (Glicko-2 preferred, Elo acceptable), and returns the MatchResult to both clients for replay. The server owning every roll follows from computing the whole match server-side.
5. Integrity: a verify endpoint that re-runs a stored match and asserts the result hash matches; reject builds failing schema validation; enforce request size limits and rate limits.
6. Replays and ladder: endpoints for a match replay (re-run from stored inputs, or stored event log), a player's match history, and a leaderboard ordered by rating.
7. Client integration in packages/web: an online mode that registers and logs in, saves builds to the server, queues for ranked, and replays the returned MatchResult using the Phase 1 viewer. Offline mode stays intact and uses the same core with no server.
8. Tooling and tests: Vitest with a disposable PostgreSQL (testcontainers, or a docker-compose Postgres service in CI). A migration test, an integration test that a queued match resolves and persists with a verifiable hash and updated ratings, and the cross-surface parity test extended to the server. A docker-compose.yml for local Postgres and a Dockerfile for the server for local and CI use. CI runs migrations and tests against the Postgres service.
9. Docs: update README (run the server locally, environment variables, migrations, how online mode works) and CLAUDE.md (server authority, client submits intent only, reproducibility and version pinning, auth uses vetted libraries and never hand-rolled crypto).

Out of scope: real-time per-tick multiplayer netcode (not needed), client-side prediction or reconciliation, cloud deployment and orchestration, the Python gym, payments, economy, or tokens, social features beyond ladder and match history, production email delivery infrastructure (stub email or a simple dev provider is fine).

TECH
TypeScript (strict), Fastify, PostgreSQL with Drizzle ORM and drizzle-kit (or Prisma), Zod (reuse core's schemas, integrate via a Zod type provider), argon2 for hashing, a vetted session or JWT library, Vitest with testcontainers or a docker-compose Postgres, Docker for local and CI. Reuse @warwright/core directly; do not duplicate any rules.

DEFINITION OF DONE
From a clean clone, all succeed:
- docker-compose up starts PostgreSQL and migrations apply cleanly
- pnpm -r typecheck; pnpm -r lint; pnpm -r test all green, including an integration test against a real PostgreSQL and the cross-surface parity test
- the server starts; a test can register, log in, save a warband, queue, get matched, and have the match resolved server-side and persisted, with ratings updated
- the verify endpoint confirms a stored match's result hash equals a fresh re-run, and equals the CLI and client for the same inputs
- the web client online mode completes the full loop: log in, save a build, queue, and replay the returned result, while offline mode still works unchanged
- auth uses argon2id and a vetted session mechanism, no hand-rolled crypto, and auth endpoints are rate-limited
Finish with a short summary: the data model, the auth approach and why it is safe, how server authority and reproducibility are enforced, and any decisions or assumptions.
```

---

## Section H. Phase 3 specification, training environment and Foundry

Phase 3 adds a way to train Behavior policies and a gated pipeline for community-contributed Behaviors. It does not touch the engine's rules.

Gate 3 decision (make at the start): how Python reaches the deterministic core.
- Default: a Node subprocess running the unchanged @warwright/core, driven by a batched (vectorized) stepped protocol, so one process steps many parallel matches per round trip. This preserves the single source of truth and identical determinism, and batching gives acceptable throughput.
- Escape hatch, only if throughput is the bottleneck: a compiled core (Rust or AssemblyScript) that becomes the new single source of truth for all runtimes, with a one-time migration and a mandatory parity test between the TypeScript core and the compiled core during the transition. This is an architecture change, not a quick fix; choose it deliberately, because a second engine implementation threatens the parity invariant. Do not silently fork the rules into Python.

```
ROLE
You are a senior ML and systems engineer who builds reinforcement-learning environments around existing deterministic simulators. You wrap the engine rather than re-implementing it, and you keep training reproducible.

GOAL
Build a Python reinforcement-learning environment that trains Warwright Behavior policies against the existing deterministic core, an export path that turns a trained policy into a deterministic TypeScript Behavior, and a Foundry that gates community-submitted Behaviors. Do not re-implement any game rules in Python.

CONTEXT
@warwright/core (Phases 0 to 2) is the single source of truth. A Behavior is a pure function decide(unitView, worldView, rng) -> Action. Today Behaviors are hand-written TypeScript modules. This phase lets a Behavior also be a trained policy, while keeping every Behavior deterministic at play time. The transport between Python and the core is the Gate 3 decision above; implement the chosen transport and keep the core authoritative.

PRIME DIRECTIVE, REUSE AND DETERMINISM
- Python never re-implements rules. The environment steps the real core through the chosen transport. If the transport drifts from the core, that is a transport bug, not a reason to fork logic.
- Training reproducibility: a fixed seed and a fixed policy yield identical trajectories across runs.
- Play-time determinism for learned policies: a trained policy must run inside the TypeScript core as a pure Behavior with no Python and no platform-variant math. Export the policy as weights plus a pure-TypeScript inference function that evaluates at float64 in a fixed operation order. The deployed Behavior's ground truth is this TypeScript inference, and a parity test pins its output for a set of fixed observations. This keeps the "Behaviors are deterministic modules" invariant intact for learned policies.

SCOPE, v3 TRAINING AND FOUNDRY
In scope:
1. A Python package (for example warwright-gym) exposing a Gymnasium environment. reset() and step(action) wrap the deterministic core through the Gate 3 transport. Use vectorized environments so many matches step per round trip.
2. Observation and action spaces: encode a unit's view (own state, allies, enemies, cooldowns, resources, squared distances) as the observation; the action space mirrors the Behavior action set (move, target selection, which skill). Document the encoding so it matches the TypeScript inference exactly.
3. A reward shaping module: a terminal reward on win or loss, with optional intermediate shaping (damage dealt, ally survival, objective control). Keep shaping configurable.
4. A small reference policy and a smoke-level training script that demonstrably improves win rate against a fixed baseline roster. Strength is not the goal; a measurable improvement and a clean training loop are.
5. The export path: a script that converts a trained policy into a TypeScript Behavior module (weights plus the pure-TypeScript float64 inference function) that registers in the core like any other Behavior and plays in the CLI and the sandbox.
6. The Foundry: a submission pipeline (GitHub-based) for Behaviors, rule-based or exported policies. CI runs, in order: interface and schema validation, a determinism and purity check (the Behavior imports nothing forbidden and is side-effect free), and a seed-based ladder gauntlet where the submission plays a fixed set of matches against a baseline roster on the deterministic core. Only submissions that validate and clear a baseline bar are eligible to merge. Results are reproducible from seeds.
7. Tooling and tests: Python tooling (uv or poetry, ruff, pytest); a transport protocol test where Python and TypeScript agree on the observation and action encoding; a gym determinism test (a fixed seed and policy yields identical trajectories); the TypeScript inference parity test for exported policies; and the Foundry gauntlet as a reproducible test. CI runs both the TypeScript and Python suites.

Out of scope: distributed or multi-GPU training infrastructure, a hosted training service, real-money anything, and the compiled-core migration unless Gate 3 selected it. Keep training runnable on a single box.

TECH
Python with Gymnasium, a standard RL library (for example Stable-Baselines3 or CleanRL), uv or poetry, ruff, pytest. The chosen Gate 3 transport to @warwright/core. On the TypeScript side: the pure-float64 inference function and the Behavior registration. No new game rules anywhere.

DEFINITION OF DONE
- env.reset() and env.step() work against the real core through the chosen transport; a random-policy rollout runs end to end.
- A smoke-level training run improves win rate against a fixed baseline by a measurable margin.
- A trained policy exports to a TypeScript Behavior that loads in the core and plays in the CLI and sandbox; the TypeScript inference parity test passes.
- The gym environment is deterministic: a fixed seed and fixed policy produce identical trajectories across runs.
- The Foundry CI accepts a valid sample Behavior (running validation plus a seed-based ladder gauntlet) and rejects a deliberately invalid one.
- The TypeScript and Python test suites are green in CI.
Finish with a short summary: the transport you implemented and why, the observation and action encoding, how learned policies stay deterministic at play time, and any decisions or assumptions.
```

---

## Section I. Phase 4 specification, content depth, modes, identity, and cosmetics

Phase 4 is depth and polish on the proven core: more content, more modes, a balance workflow, an optional visual identity, and a cosmetics-only economy. The earlier invariants still hold, and the engine is extended only minimally and only with a ruleset version bump.

Gate 4 decision (make at the start): the size of the content batch, and whether to invest in a commissioned or curated visual identity now or stay procedural.

```
ROLE
You are a senior game designer and engineer focused on content systems and balance. You add depth through data and configuration, not through engine rewrites, and you protect competitive integrity.

GOAL
Add content depth (more Roles and Skills, augments, the Wellspring objective), at least one new arena mode, a balance workflow built on deterministic replays, an optional visual identity behind the asset adapter, and a cosmetics-only economy. Preserve every earlier invariant.

CONTEXT
The deterministic core, the sandbox, the server, and the gym all exist. Content is data-as-code (Zod-validated) plus Behavior modules. Modes are configurations over the same core, not engine forks. Any change that alters match outcomes bumps the ruleset version, and old replays re-run under their recorded version. Cosmetics must never touch a sim input.

PRIME DIRECTIVE, INTEGRITY
- Content is data and registered modules; extend the engine only when a new primitive genuinely requires it, and when you do, bump the ruleset version and regenerate the golden-replay snapshot with a note explaining the change.
- Cross-surface parity and the golden-replay test still gate every change.
- Cosmetics-only: no cosmetic, purchase, or progression unlock may alter any value the sim reads. Add an invariant test that proves a cosmetic cannot change a match input. No pay-to-win, no tokens, no web3, and no gambling-style randomized purchase mechanics.

SCOPE, v4 DEPTH AND IDENTITY
In scope:
1. Content depth: additional Roles and Skills, and augments (modifiers that adjust unit or skill behavior), all as Zod-validated data or registered Behavior modules. Reuse existing engine primitives where possible.
2. The Wellspring objective: a contested map feature that buffs whoever channels it, adding positional strategy. Implement it as engine-supported content; if it needs a new primitive, add it minimally and bump the version.
3. At least one new arena mode (for example a Wellspring mode or a different team size), expressed as a mode configuration over the same core. The mode is playable end to end: builder, match, playback, offline, and in ranked if the server is live.
4. A balance workflow: a headless batch runner that plays many matchups across seeds and produces a win-rate matrix and a short balance report. This relies on the determinism of the core, so results are reproducible. Optionally use the Phase 3 ladder for automated balance probing.
5. Optional visual identity: if adopted, a curated or commissioned asset set loaded only through the AssetProvider adapter from Phase 1, with procedural remaining the default and fallback. Document every asset's license. Do not couple art to game or render logic, and do not adopt AI-generated raster art unless style coherence and licensing are clearly solved.
6. Cosmetics-only economy (optional): account-level cosmetic ownership held server-side (extending Phase 2). Cosmetics are selectable but provably cannot affect the sim. Keep payment processing abstracted behind an interface; do not build real payment integration unless explicitly chosen at Gate 4.
7. Tooling and tests: content-validation tests for all new content; the cosmetic-integrity invariant test; the balance batch runner as a reproducible job; and all prior tests still green. Update README and CLAUDE.md.

Out of scope: real payment-processor integration and PCI scope unless chosen at Gate 4, physical goods, and anything that touches sim balance through monetization.

TECH
Reuse the existing stack. Content and modes as Zod-validated data and configuration over @warwright/core. The balance runner uses the headless CLI path. Cosmetics extend the Phase 2 server schema. No new rules engine.

DEFINITION OF DONE
- New Roles, Skills, augments, and the Wellspring objective are added as validated data or modules; content-validation tests pass; the ruleset version is bumped and the golden-replay snapshot regenerated with a note.
- At least one new arena mode is playable end to end offline, and in ranked if the server is live.
- The balance batch runner produces a reproducible win-rate matrix and a short report from fixed seeds.
- If a visual identity is adopted, it loads only through the AssetProvider adapter, procedural stays the default, and asset licenses are documented.
- If a cosmetic economy is implemented, the cosmetic-integrity invariant test proves no cosmetic alters a sim input, and cosmetics are server-side account state with no pay-to-win.
- All earlier gates still pass (determinism, parity).
Finish with a short summary: what content and modes you added, how you kept the engine changes minimal and versioned, the balance findings if any, and any decisions or assumptions.
```

---

## Section J. Consolidated CLAUDE.md

Place this at the repo root as CLAUDE.md so every session and subagent inherits the rules.

```
# Warwright, working notes for Claude

## What this is
An autobattler. Units are configured (Role, Skills, Behavior) and fight autonomously. The deterministic core in packages/core/src/sim is the single source of truth. Every runtime (CLI, browser, server, future gym) wraps this core and never re-implements combat.

## Determinism contract, do not break
- sim/ imports nothing from Node, the DOM, the network, or any renderer.
- One seeded PRNG (mulberry32) is the only randomness. No Math.random, Date, Date.now, performance.now, or crypto under sim/.
- Time is integer ticks at 20 Hz. Cooldowns, durations, regen are in ticks.
- Integer combat math. No Math.sqrt or trig in sim/; compare squared distances.
- Units processed each tick in ascending id order; RNG draws follow that order.
- A replay is { version, seed, buildA, buildB } and reproduces the full match.
- The golden-replay test must pass. If the log changes intentionally, bump the ruleset version and regenerate the snapshot in the same commit, with a note on why.

## Cross-surface parity, do not break
- For a fixed seed and the same builds, the CLI, the browser client, and the server produce the same winner and the same event-log hash. The parity test must pass; if it fails, a surface diverged and must be fixed, not the test.

## Layout
- packages/core/src/sim, pure engine.
- packages/core/src/content, Roles and Skills as Zod-validated data; Behaviors as modules registered by id.
- packages/core/src/api, documented seams for server and gym (interfaces only).
- packages/cli, thin runner over the core.
- packages/web, browser sandbox. The client is a pure view; it calls @warwright/core and renders the event log, never re-implements resolve logic, and never imports core's internal sim resolve modules directly. requestAnimationFrame drives rendering only.
- packages/server, authoritative service. The server is the only place a ranked match is resolved; clients submit intent only. Every match is reproducible from version, seed, and snapshotted builds. Auth uses vetted libraries (argon2id, a vetted session or JWT library) and never hand-rolled crypto. Snapshot builds at match time and pin the ruleset version per match.
- gym/ (Python), the training environment. It drives @warwright/core through a batched bridge and never re-implements rules. Trained policies ship as weights plus a pure-TypeScript float64 inference Behavior, subject to the determinism contract.

## Art conventions
- Default art is procedural, drawn on canvas at runtime. No bundled third-party assets.
- Ability icons are deterministic from the skill id. Units encode Role by color and shape, hp by size.
- A CC0 pack may be added later only through the AssetProvider adapter, never by coupling art to game or render logic.

## Content, learned behaviors, and cosmetics
- Content is data-as-code (Roles, Skills, augments) validated by Zod, plus registered Behavior modules. Add engine primitives only when truly needed; when a change alters outcomes, bump the ruleset version and regenerate the golden-replay snapshot.
- Learned policies are Behaviors too: they ship as weights plus a pure-TypeScript float64 inference function, run inside the core with no Python at play time, and are parity-tested against fixed observations. The training environment wraps the core and never re-implements rules.
- Cosmetics-only: no cosmetic, purchase, or unlock may change any value the sim reads, and an invariant test must prove it. No pay-to-win, no tokens, no gambling-style purchase mechanics.

## Model routing (build process)
- Code generation runs on Sonnet subagents. The code-reviewer subagent runs on Opus at max effort with read-only tools. Routing is by per-subagent frontmatter, not the CLAUDE_CODE_SUBAGENT_MODEL env var, which must stay unset so the per-role split holds. Every change passes the reviewer before it is done.

## Conventions
- TypeScript strict. Validate all external data with Zod and fail loud.
- Small, pure functions in resolve/. CLI and renderer output derives only from the event log.
- Commit in logical chunks. Run typecheck, lint, and test before declaring work done.
```
