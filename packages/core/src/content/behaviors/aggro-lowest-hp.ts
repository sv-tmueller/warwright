import type { Action, Behavior, UnitView, WorldView } from '../../sim/behavior.js';
import type { Rng } from '../../sim/prng.js';
import { isInRange } from '../../sim/resolve/geometry.js';
import { pickBest } from './select.js';

function decide(self: UnitView, world: WorldView, rng: Rng): Action {
  const target = pickBest(world.enemiesOf(self), (a, b) => a.hp < b.hp, rng);
  if (!target) return { kind: 'idle' };
  return isInRange(self.pos, target.pos, self.attackRangeSquared)
    ? { kind: 'attack', targetId: target.id }
    : { kind: 'move-toward', targetId: target.id };
}

export const aggroLowestHp: Behavior = {
  id: 'aggro-lowest-hp',
  decide,
};
