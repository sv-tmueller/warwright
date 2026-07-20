// A pure, VALID Behavior (no forbidden tokens, no module-level mutable
// state) that always returns { kind: 'idle' }. Passes stage 1 (manifest +
// entry) and stage 2 (static purity scan + same-run idempotence -- idle
// every call is trivially idempotent). Rejected at STAGE 3: it never
// attacks, so it draws or loses -- either way a non-win (0/25) -- against
// the approaching baseline roster (measured: it actually LOSES, in ~1700
// ticks, well before the MATCH_TICK_CAP; a draw would score the same, since
// both a 'draw' and a loss count as a non-win). Scores a ~0 win rate, well
// below BASELINE_WIN_RATE_THRESHOLD (see stage3.ts).
import type { Action, Behavior, UnitView, WorldView } from '@warwright/core';

function decide(_self: UnitView, _world: WorldView): Action {
  return { kind: 'idle' };
}

export const behavior: Behavior = {
  id: 'weak-idle',
  decide,
};
