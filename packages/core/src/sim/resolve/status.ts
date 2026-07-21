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
  } else if (kind === 'stun') {
    // Single-slot, overwrite-on-reapply (last write wins), mirroring slow.
    // magnitude is carried but unread: gating (sim/loop.ts's applyAction)
    // only checks presence, never magnitude.
    unit.stun = { magnitude, remainingTicks: durationTicks };
  } else if (kind === 'empower') {
    // Single-slot, overwrite-on-reapply (last write wins), mirroring slow.
    // The single positive-buff kind: magnitude is an integer percent bonus
    // applied at attack resolution (resolve/combat.ts) and move resolution
    // (resolve/movement.ts) only -- never to direct-damage/heal amounts.
    // #71 Wellspring's channel-buff must apply this 'empower' kind, never
    // define its own positive-buff status kind.
    unit.empower = { magnitude, remainingTicks: durationTicks };
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

  if (unit.stun !== null) {
    unit.stun.remainingTicks -= 1;
    if (unit.stun.remainingTicks <= 0) {
      unit.stun = null;
      emit(log, { kind: 'status-expired', tick, targetId: unit.id, status: 'stun' });
    }
  }

  if (unit.empower !== null) {
    unit.empower.remainingTicks -= 1;
    if (unit.empower.remainingTicks <= 0) {
      unit.empower = null;
      emit(log, { kind: 'status-expired', tick, targetId: unit.id, status: 'empower' });
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
