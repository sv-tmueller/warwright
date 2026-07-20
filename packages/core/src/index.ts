import {
  aggroLowestHp,
  focusCasters,
  policySmokeV1,
  protectAllies,
} from './content/behaviors/index.js';

export { runMatch } from './sim/match.js';
export type { MatchResult, RunMatch, Winner, WorldState } from './sim/types.js';
export type { MatchEvent } from './sim/events.js';
export type { Action, Behavior, SkillView, UnitView, WorldView } from './sim/behavior.js';
export type { Rng } from './sim/prng.js';
export { mulberry32 } from './sim/prng.js';
export { RULESET_VERSION } from './sim/constants.js';
export { createSteppedMatch, EXTERNAL_BEHAVIOR_ID } from './sim/stepped.js';
export { runMatchWithBehaviors } from './sim/match-with-behaviors.js';
export type { Replay, SteppedTransport } from './api/seams.js';
export {
  OBS_ENCODING_VERSION,
  OBS_SELF_FIELD_COUNT,
  OBS_UNIT_FIELD_COUNT,
  decodeAction,
  encodeAction,
  encodeObservation,
} from './sim/observation.js';
export { BehaviorIdSchema, parseWarband, UnitBuildSchema, WarbandSchema } from './content/schemas.js';
export type { Role, Skill, UnitBuild, Warband } from './content/schemas.js';
export { roles } from './content/data/roles.js';
export { skills } from './content/data/skills.js';

// The exported #66a/#66b policy-smoke-v1 Behavior (weights + pure-TS
// float64 inference; see policy-smoke-v1.ts), re-exported by NAME
// (deliberately not part of the `behaviorIds` id-only enumeration below,
// which stays ids-only for content-selection clients like the web
// builder). This is the one Behavior OBJECT the public API exposes: an
// exported-policy foundry submission (packages/foundry/submissions/
// sample-policy) needs the actual `decide` function to reuse it under its
// own new Behavior id, since a submission can only import '@warwright/core'
// (see packages/foundry/src/purity.ts's import allowlist) -- it cannot
// reach into core's internals to get the trained weights + inference logic
// any other way.
export { policySmokeV1 } from './content/behaviors/index.js';

// Public content enumeration for clients that build Warbands (the web
// builder), so they can only offer choices core actually recognizes. Ids
// only, not the Behavior objects themselves (decide() stays internal) --
// `policySmokeV1` above is the sole, deliberate exception, for the reason
// documented there.
export const behaviorIds = [
  aggroLowestHp.id,
  protectAllies.id,
  focusCasters.id,
  policySmokeV1.id,
] as const;
