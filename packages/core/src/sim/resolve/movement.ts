import { emit, type MatchEvent } from '../events.js';
import type { Position, Unit } from '../types.js';
import { stepToward } from './geometry.js';

/**
 * Steps a unit one tick toward target, honoring the empower and slow
 * statuses read-only (never sets statuses) and emitting a move event only
 * on actual displacement. Does not resolve combat. When both are active,
 * empower is applied first, then slow, as two sequential integer-division
 * steps (not combined into one formula).
 */
export function moveUnitToward(
  unit: Unit,
  target: Position,
  log: MatchEvent[],
  tick: number,
): void {
  let maxStep = unit.moveSpeed;
  if (unit.empower !== null) {
    maxStep = Math.trunc((maxStep * (100 + unit.empower.magnitude)) / 100);
  }
  if (unit.slow !== null) {
    maxStep = Math.trunc((maxStep * (100 - unit.slow.magnitude)) / 100);
  }

  const next = stepToward(unit.pos, target, maxStep);

  if (next.x === unit.pos.x && next.y === unit.pos.y) {
    return;
  }

  emit(log, {
    kind: 'move',
    tick,
    unitId: unit.id,
    from: { x: unit.pos.x, y: unit.pos.y },
    to: { x: next.x, y: next.y },
  });

  unit.pos = next;
}
