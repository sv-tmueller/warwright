import type { RunMatch, MatchResult, WorldState } from '../sim/types.js';
import type { Action } from '../sim/behavior.js';

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
// Grounding fact (a): observations/rewards are derived by the trainer FROM
// `WorldState`/`MatchResult` — this seam exposes engine state only, no ML
// shaping. Batching is achieved by a bridge running N instances of this
// single-match transport; arrays/batch surface are not baked into this
// interface.
//
// Grounding fact (b) is SUPERSEDED (see #119, landed in #121): units still
// carry `behaviorId` in `WorldState` and decide autonomously by default via
// their registered Behavior, BUT `step`'s optional `actions` param is the
// injection contract for a learned/external policy under training. An
// entry in `actions` is consulted ONLY for a unit whose `behaviorId` is the
// `'external'` sentinel (`EXTERNAL_BEHAVIOR_ID`, exported by
// `sim/stepped.ts`); every other unit still decides via its registered
// Behavior, unaffected. A living external unit with no entry in `actions`
// is a caller bug and throws loud rather than silently idling. When `ticks`
// > 1, the same `actions` map is replayed on every tick advanced by the
// call (action-repeat) — callers that want per-tick actions call `step(1)`
// in a loop.
//
// WARNING (load-bearing): `reset`/`step` return the engine's LIVE MUTABLE
// `WorldState`, not a copy. Callers (the #63 gym bridge) MUST treat it as
// read-only and derive observations from it only; mutating it would
// silently corrupt determinism (the same instance backs subsequent ticks).
// Also: if `step` throws because a living external unit had no entry in
// `actions`, the transport is left mid-tick and MUST NOT be reused as-is —
// call `reset()` before stepping again to get a usable instance.
export interface SteppedTransport {
  reset(replay: Replay): WorldState;
  step(ticks: number, actions?: ReadonlyMap<number, Action>): WorldState;
  done(): boolean;
  result(): MatchResult;
}
