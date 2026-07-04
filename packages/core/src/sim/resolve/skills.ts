import { emit } from '../events.js';
import type { MatchEvent } from '../events.js';
import type { Unit } from '../types.js';
import type { StatusKind } from '../vocab.js';
import { dealDamage, heal } from './combat.js';
import { applyStatus } from './status.js';

// Declared locally (not imported from content/) so content -> sim stays a
// one-directional dependency: content already imports from sim, and the
// reverse import would create a cycle. A real content Skill.effect value is
// structurally identical and assignable here with no cast.
export type SkillEffect =
  | { kind: 'direct-damage'; amount: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'apply-status'; status: StatusKind; durationTicks: number; magnitude: number };

export function resolveSkillEffect(
  caster: Unit,
  target: Unit,
  skillId: string,
  effect: SkillEffect,
  log: MatchEvent[],
  tick: number,
): void {
  emit(log, { kind: 'cast', tick, unitId: caster.id, skillId, targetId: target.id });

  if (effect.kind === 'direct-damage') {
    dealDamage(target, effect.amount, caster.id, log, tick);
  } else if (effect.kind === 'heal') {
    heal(target, effect.amount, caster.id, log, tick);
  } else {
    applyStatus(target, effect.status, effect.durationTicks, effect.magnitude, log, tick);
  }
}
