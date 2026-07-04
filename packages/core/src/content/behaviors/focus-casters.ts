import type { Action, Behavior, UnitView, WorldView } from '../../sim/behavior.js';
import type { Rng } from '../../sim/prng.js';
import { squaredDistance } from '../../sim/resolve/geometry.js';
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
  return target ? { kind: 'attack', targetId: target.id } : { kind: 'idle' };
}

export const focusCasters: Behavior = {
  id: 'focus-casters',
  decide,
};
