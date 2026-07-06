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

## Useful commands
All commands run from the repo root.

```bash
# install workspace dependencies
pnpm install
# type-check every package
pnpm typecheck
# lint every package
pnpm lint
# run the test suites
pnpm test
# flagship demo: run a full match and print the event log and winner
pnpm sim:run --seed 42 --a builds/warband-a.json --b builds/warband-b.json
# regenerate the golden-replay snapshot; see the ruleset-version rule in the determinism contract section above
pnpm --filter @warwright/core gen-golden
```
