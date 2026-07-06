import type { Action, Behavior, UnitView, WorldView } from '../../sim/behavior.js';
import type { Rng } from '../../sim/prng.js';
import { isInRange, squaredDistance } from '../../sim/resolve/geometry.js';
import { pickBest } from './select.js';

function decide(self: UnitView, world: WorldView, rng: Rng): Action {
  const enemies = world.enemiesOf(self);
  const casters = enemies.filter((enemy) => enemy.skills.length > 0);
  const pool = casters.length > 0 ? casters : enemies;

  const target = pickBest(
    pool,
    (a, b) => squaredDistance(self.pos, a.pos) < squaredDistance(self.pos, b.pos),
    rng,
  );
  if (!target) return { kind: 'idle' };
  return isInRange(self.pos, target.pos, self.attackRangeSquared)
    ? { kind: 'attack', targetId: target.id }
    : { kind: 'move-toward', targetId: target.id };
}

export const focusCasters: Behavior = {
  id: 'focus-casters',
  decide,
};
