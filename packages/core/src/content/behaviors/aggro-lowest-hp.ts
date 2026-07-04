import type { Action, Behavior, UnitView, WorldView } from '../../sim/behavior.js';
import type { Rng } from '../../sim/prng.js';
import { pickBest } from './select.js';

function decide(self: UnitView, world: WorldView, rng: Rng): Action {
  const target = pickBest(world.enemiesOf(self), (a, b) => a.hp < b.hp, rng);
  return target ? { kind: 'attack', targetId: target.id } : { kind: 'idle' };
}

export const aggroLowestHp: Behavior = {
  id: 'aggro-lowest-hp',
  decide,
};
