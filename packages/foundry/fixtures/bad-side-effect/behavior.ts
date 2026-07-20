// Deliberately impure fixture (see purity.test.ts): module-level mutable
// state. This passes stage 2's STATIC scan (no forbidden tokens, no
// disallowed imports) but must be rejected by stage 2's RUNTIME (same-run,
// run-twice) idempotence check: `counter` carries over between the two
// runs, so the second run's decide sequence diverges from the first run's,
// producing a different event-log hash.
import type { Action, Behavior, UnitView, WorldView } from '@warwright/core';

function squaredDistance(a: UnitView['pos'], b: UnitView['pos']): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

let counter = 0;

function decide(self: UnitView, world: WorldView): Action {
  counter += 1;
  const enemies = world.enemiesOf(self);
  const target = enemies[0];
  if (target === undefined) return { kind: 'idle' };
  if (counter % 3 === 0) return { kind: 'idle' };

  return squaredDistance(self.pos, target.pos) <= self.attackRangeSquared
    ? { kind: 'attack', targetId: target.id }
    : { kind: 'move-toward', targetId: target.id };
}

export const behavior: Behavior = {
  id: 'bad-side-effect',
  decide,
};
