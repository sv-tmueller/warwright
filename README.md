# Warwright

An autobattler built on one deterministic core. Units are configured (Role, Skills, Behavior) and fight autonomously. Same inputs (ruleset version, seed, two warbands) always produce a byte-identical event log, on every machine and every run. Every runtime (CLI, browser, server, future training gym) wraps this one core and never re-implements combat.

Warwright is original IP. It borrows the architecture of World of Claudecraft (one deterministic core reused across runtimes), not its assets or lore. No tokens, no web3; cosmetics only, much later.

## Status

Repository scaffolding only. No engine code yet. The build runs in five gated phases (see below); each phase is kicked off and approved separately.

## Build plan

The complete specification lives in [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md). The cross-phase house rules (the determinism contract, cross-surface parity, layout, art and content conventions) live in [`CLAUDE.md`](CLAUDE.md) and are inherited by every session and subagent.

## Phases

- Phase 0: deterministic core and CLI.
- Phase 1: playable browser sandbox (pure view over the core).
- Phase 2: authoritative server and ranked ladder.
- Phase 3: Python training environment and the Foundry.
- Phase 4: content depth, modes, identity, cosmetics-only economy.

Each phase has its own Definition of Done and a human gate. The next phase does not start until the current gate passes. See the roadmap issue on GitHub for the current state.

## Invariants (do not break)

- The simulation in `packages/core/src/sim` is pure: no Node, DOM, network, or rendering imports; one seeded PRNG; integer ticks at 20 Hz; integer combat math.
- A replay is exactly `{ version, seed, buildA, buildB }` and reproduces the full match.
- Cross-surface parity: for a fixed seed and the same builds, the CLI, the browser, and the server produce the same winner and the same event-log hash. The parity test must pass; if it fails, a surface diverged and gets fixed, not the test.
