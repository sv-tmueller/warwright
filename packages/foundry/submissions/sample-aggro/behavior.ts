// A self-contained, rule-based sample submission: target the lowest-hp
// living enemy and either attack (if in range) or move toward it. Imports
// ONLY from '@warwright/core' (the public API) as required by the foundry
// gate's stage-2 import allowlist -- no sim internals, no relative escapes
// outside this directory.
import type { Action, Behavior, UnitView, WorldView } from '@warwright/core';

function squaredDistance(a: UnitView['pos'], b: UnitView['pos']): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function decide(self: UnitView, world: WorldView): Action {
  const enemies = world.enemiesOf(self);

  let target: UnitView | undefined;
  for (const enemy of enemies) {
    if (target === undefined || enemy.hp < target.hp) target = enemy;
  }
  if (target === undefined) return { kind: 'idle' };

  return squaredDistance(self.pos, target.pos) <= self.attackRangeSquared
    ? { kind: 'attack', targetId: target.id }
    : { kind: 'move-toward', targetId: target.id };
}

export const behavior: Behavior = {
  id: 'sample-aggro',
  decide,
};
