import type { Action, Behavior, UnitView, WorldView } from '../../sim/behavior.js';
import type { Rng } from '../../sim/prng.js';
import { pickBest } from './select.js';

// Cross-multiplied hp/maxHp ratio comparison, kept integer-only per the
// determinism contract (no floating-point division).
function lowerRatio(a: UnitView, b: UnitView): boolean {
  return a.hp * b.maxHp < b.hp * a.maxHp;
}

function decide(self: UnitView, world: WorldView, rng: Rng): Action {
  const target = pickBest(world.alliesOf(self), lowerRatio, rng);
  return target ? { kind: 'move-toward', targetId: target.id } : { kind: 'idle' };
}

export const protectAllies: Behavior = {
  id: 'protect-allies',
  decide,
};
