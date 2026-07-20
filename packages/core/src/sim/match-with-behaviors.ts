import type { Replay } from '../api/seams.js';
import { MATCH_TICK_CAP } from './constants.js';
import { createSteppedMatch } from './stepped.js';
import type { Behavior } from './behavior.js';
import type { MatchResult } from './types.js';

// Additive core seam (see the #135 SUB_PLAN): runs a match with the seed
// Behaviors PLUS `extraBehaviors` registered into the same
// createSeedRegistryWith registry stepTick resolves against (see
// stepped.ts). Never adds behaviors to the Replay tuple -- a Replay stays
// exactly { version, seed, buildA, buildB }; a unit picks up an extra
// Behavior purely by its build's `behaviorId` referencing that Behavior's
// id. With extraBehaviors === [] this is bit-identical to runMatch (both
// delegate to createSteppedMatch, which defaults its own extraBehaviors
// param to []), so runMatch is unaffected by this seam's existence.
export function runMatchWithBehaviors(
  replay: Replay,
  extraBehaviors: readonly Behavior[],
): MatchResult {
  const match = createSteppedMatch(replay, extraBehaviors);
  match.step(MATCH_TICK_CAP);
  return match.result();
}
