import { aggroLowestHp, focusCasters, protectAllies } from './content/behaviors/index.js';

export { runMatch } from './sim/match.js';
export type { MatchResult, RunMatch, Winner, WorldState } from './sim/types.js';
export type { MatchEvent } from './sim/events.js';
export type { Action } from './sim/behavior.js';
export { RULESET_VERSION } from './sim/constants.js';
export { createSteppedMatch, EXTERNAL_BEHAVIOR_ID } from './sim/stepped.js';
export type { Replay, SteppedTransport } from './api/seams.js';
export { parseWarband, WarbandSchema } from './content/schemas.js';
export type { Role, Skill, UnitBuild, Warband } from './content/schemas.js';
export { roles } from './content/data/roles.js';
export { skills } from './content/data/skills.js';

// Public content enumeration for clients that build Warbands (the web
// builder), so they can only offer choices core actually recognizes. Ids
// only, not the Behavior objects themselves (decide() stays internal).
export const behaviorIds = [aggroLowestHp.id, protectAllies.id, focusCasters.id] as const;
