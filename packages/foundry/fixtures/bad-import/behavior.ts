// Deliberately impure fixture (see purity.test.ts): a forbidden Node import
// and Math.random. This must be rejected by stage 2's STATIC scan, before
// the entry module is ever dynamically imported -- so this file's decide()
// is never actually executed by the gate's own tests.
import { readFileSync } from 'node:fs';
import type { Action, Behavior, UnitView, WorldView } from '@warwright/core';

function decide(self: UnitView, world: WorldView): Action {
  void readFileSync;
  const enemies = world.enemiesOf(self);
  const index = Math.floor(Math.random() * enemies.length);
  const target = enemies[index];
  if (target === undefined) return { kind: 'idle' };
  return { kind: 'attack', targetId: target.id };
}

export const behavior: Behavior = {
  id: 'bad-import',
  decide,
};
