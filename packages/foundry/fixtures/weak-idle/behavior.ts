// A pure, VALID Behavior (no forbidden tokens, no module-level mutable
// state) that always returns { kind: 'idle' }. Passes stage 1 (manifest +
// entry) and stage 2 (static purity scan + same-run idempotence -- idle
// every call is trivially idempotent). Rejected at STAGE 3: it never
// attacks, so it stalls every gauntlet match to the MATCH_TICK_CAP -- a
// 'draw', which counts as a non-win -- scoring a ~0 win rate, well below
// BASELINE_WIN_RATE_THRESHOLD (see stage3.ts).
import type { Action, Behavior, UnitView, WorldView } from '@warwright/core';

function decide(_self: UnitView, _world: WorldView): Action {
  return { kind: 'idle' };
}

export const behavior: Behavior = {
  id: 'weak-idle',
  decide,
};
