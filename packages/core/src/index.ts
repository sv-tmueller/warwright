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

// Public content enumeration for clients that build Warbands (the web
// builder), so they can only offer choices core actually recognizes. Ids
// only, not the Behavior objects themselves (decide() stays internal).
export const behaviorIds = [
  aggroLowestHp.id,
  protectAllies.id,
  focusCasters.id,
  policySmokeV1.id,
] as const;
