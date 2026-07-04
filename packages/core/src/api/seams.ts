import type { RunMatch, MatchResult, WorldState } from '../sim/types.js';

// The replay tuple that fully reproduces a match: a ruleset version, a PRNG
// seed, and the two snapshotted builds. `buildA`/`buildB` stay `unknown`
// for the same reason as the engine: Zod Warband validation happens inside
// the core, not at this seam.
export type Replay = Parameters<RunMatch>[0];

// Authoritative match-runner seam. The server is the ONLY place a ranked
// match resolves; clients submit a `Replay` (intent), never a resolved
// outcome. A future server snapshots both builds and pins the ruleset
// `version` at match time. Because a match is fully reproducible from
// `{ version, seed, buildA, buildB }`, equal `Replay`s yield equal
// `MatchResult`s (same `winner`, same event-log `hash`). `run` is kept
// synchronous to mirror the engine's `RunMatch`; transport/persistence
// concerns (possibly async) are a future implementer's responsibility,
// outside this shape.
export interface MatchRunner {
  run(replay: Replay): MatchResult;
}

// Stepped seam for a future gym bridge. The gym drives the deterministic
// core through this stepped interface and never re-implements rules.
// `reset` initializes from a `Replay` and returns the initial `WorldState`
// (the observation source). `step` advances the core by `ticks` integer
// ticks (20 Hz) and returns the post-step `WorldState`. `done` is true once
// the match terminates. `result` gives the `MatchResult` (terminal
// `winner`/`hash`) once `done` is true.
//
// Two grounding facts: (a) observations/rewards are derived by the trainer
// FROM `WorldState`/`MatchResult` — this seam exposes engine state only, no
// ML shaping; (b) there is no per-tick action argument — units carry
// `behaviorId` in `WorldState`, so the core steps autonomously and learned
// policies are Behaviors baked into the build. Batching is achieved by a
// bridge running N instances of this single-match transport; arrays/batch
// surface are not baked into this interface.
export interface SteppedTransport {
  reset(replay: Replay): WorldState;
  step(ticks: number): WorldState;
  done(): boolean;
  result(): MatchResult;
}
