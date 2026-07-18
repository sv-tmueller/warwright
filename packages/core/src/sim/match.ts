import { MATCH_TICK_CAP } from './constants.js';
import { createSteppedMatch } from './stepped.js';
import type { RunMatch } from './types.js';

// Re-expressed over the stepped seam (see stepped.ts): a single
// step(MATCH_TICK_CAP) call reproduces the exact former while-loop
// tick-cap/break-on-winner condition (stepTick pre-increments tick, so the
// budget is identical), and the wrapper's one-time finalize() reproduces
// the former inline match-end emit + hashEventLog. No externalActions are
// ever passed, so every unit still decides via its registered Behavior —
// bit-identical to the previous inline implementation.
export const runMatch: RunMatch = (replay) => {
  const match = createSteppedMatch(replay);
  match.step(MATCH_TICK_CAP);
  return match.result();
};
