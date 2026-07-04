import { emit } from '../events.js';
import type { MatchEvent } from '../events.js';
import type { Unit } from '../types.js';
import type { StatusKind } from '../vocab.js';

// Bookkeeping only: this module deals no damage and never reads or writes
// `pos`. Combat (later work) applies slow to movement and subtracts from the
// shield pool; this module just tracks the counters and their expiry.

export function applyStatus(
  unit: Unit,
  kind: StatusKind,
  durationTicks: number,
  magnitude: number,
  log: MatchEvent[],
  tick: number,
): void {
  if (kind === 'slow') {
    unit.slow = { magnitude, remainingTicks: durationTicks };
  } else if (kind === 'shield') {
    if (unit.shield === null) {
      unit.shield = { magnitude, remainingTicks: durationTicks };
    } else {
      unit.shield.magnitude += magnitude;
      unit.shield.remainingTicks = durationTicks;
    }
  } else {
    unit.activeDots.push({ damagePerTick: magnitude, remainingTicks: durationTicks });
  }

  emit(log, {
    kind: 'status-applied',
    tick,
    targetId: unit.id,
    status: kind,
    magnitude,
    durationTicks,
  });
}

export function tickStatuses(unit: Unit, log: MatchEvent[], tick: number): void {
  if (unit.slow !== null) {
    unit.slow.remainingTicks -= 1;
    if (unit.slow.remainingTicks <= 0) {
      unit.slow = null;
      emit(log, { kind: 'status-expired', tick, targetId: unit.id, status: 'slow' });
    }
  }

  if (unit.shield !== null) {
    unit.shield.remainingTicks -= 1;
    if (unit.shield.magnitude <= 0 || unit.shield.remainingTicks <= 0) {
      unit.shield = null;
      emit(log, { kind: 'status-expired', tick, targetId: unit.id, status: 'shield' });
    }
  }

  const remainingDots = [];
  for (const dot of unit.activeDots) {
    dot.remainingTicks -= 1;
    if (dot.remainingTicks > 0) {
      remainingDots.push(dot);
    } else {
      emit(log, { kind: 'status-expired', tick, targetId: unit.id, status: 'dot' });
    }
  }
  unit.activeDots = remainingDots;
}
