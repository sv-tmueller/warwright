import type { MatchEvent } from '@warwright/core';

// Structural types read off MatchEvent's variants rather than imported by
// name: core only exports the MatchEvent union from its public surface (see
// the sub-plan on issue #48), not Position/StatusKind/Winner individually.
type MatchStartEvent = Extract<MatchEvent, { kind: 'match-start' }>;
type SpawnInfo = MatchStartEvent['units'][number];
type MatchEndEvent = Extract<MatchEvent, { kind: 'match-end' }>;
type StatusAppliedEvent = Extract<MatchEvent, { kind: 'status-applied' }>;
type AttackEvent = Extract<MatchEvent, { kind: 'attack' }>;
type CastEvent = Extract<MatchEvent, { kind: 'cast' }>;
type DamageEvent = Extract<MatchEvent, { kind: 'damage' }>;

export type Position = SpawnInfo['pos'];
export type TeamId = SpawnInfo['team'];
export type Winner = MatchEndEvent['winner'];
export type StatusKind = StatusAppliedEvent['status'];

export type StatusEntry = {
  readonly magnitude: number;
  readonly durationTicks: number;
};

export type FrameUnit = {
  readonly id: number;
  readonly team: TeamId;
  readonly roleId: string;
  readonly pos: Position;
  readonly hp: number;
  readonly maxHp: number;
  readonly dead: boolean;
  readonly statuses: Readonly<Partial<Record<StatusKind, StatusEntry>>>;
};

// Events whose kind is one of attack/cast/damage and whose tick equals the
// frame's tick: transient, drawn (if at all) as brief overlays rather than
// folded into persistent unit state (death already covers the persistent
// side of a lethal hit via the `dead` flag).
export type TickEffect = AttackEvent | CastEvent | DamageEvent;

export type FrameState = {
  readonly tick: number;
  readonly version: number | null;
  readonly seed: number | null;
  readonly units: readonly FrameUnit[];
  readonly winner: Winner | null;
  readonly tickEffects: readonly TickEffect[];
};

function isTickEffect(event: MatchEvent): event is TickEffect {
  return event.kind === 'attack' || event.kind === 'cast' || event.kind === 'damage';
}

/**
 * Derives the FrameState at tick N by folding every event with
 * `tick <= N`, in log order, into a snapshot. hp is taken verbatim from
 * each event's `hpAfter` and status presence from applied/expired pairs:
 * this module never recomputes a sim value, which keeps it a pure view (see
 * CLAUDE.md's determinism contract and the sub-plan on issue #48).
 */
export function deriveFrame(eventLog: readonly MatchEvent[], tick: number): FrameState {
  const units = new Map<number, FrameUnit>();
  let version: number | null = null;
  let seed: number | null = null;
  let winner: Winner | null = null;
  const tickEffects: TickEffect[] = [];

  for (const event of eventLog) {
    if (event.tick > tick) continue;

    if (isTickEffect(event) && event.tick === tick) {
      tickEffects.push(event);
    }

    switch (event.kind) {
      case 'match-start':
        version = event.version;
        seed = event.seed;
        for (const spawn of event.units) {
          units.set(spawn.id, {
            id: spawn.id,
            team: spawn.team,
            roleId: spawn.roleId,
            pos: spawn.pos,
            hp: spawn.hp,
            maxHp: spawn.maxHp,
            dead: false,
            statuses: {},
          });
        }
        break;
      case 'move': {
        const unit = units.get(event.unitId);
        if (unit) units.set(unit.id, { ...unit, pos: event.to });
        break;
      }
      case 'damage': {
        const unit = units.get(event.targetId);
        if (unit) units.set(unit.id, { ...unit, hp: event.hpAfter });
        break;
      }
      case 'heal': {
        const unit = units.get(event.targetId);
        if (unit) units.set(unit.id, { ...unit, hp: event.hpAfter });
        break;
      }
      case 'status-applied': {
        const unit = units.get(event.targetId);
        if (unit) {
          units.set(unit.id, {
            ...unit,
            statuses: {
              ...unit.statuses,
              [event.status]: { magnitude: event.magnitude, durationTicks: event.durationTicks },
            },
          });
        }
        break;
      }
      case 'status-expired': {
        const unit = units.get(event.targetId);
        if (unit) {
          const statuses = { ...unit.statuses };
          delete statuses[event.status];
          units.set(unit.id, { ...unit, statuses });
        }
        break;
      }
      case 'death': {
        const unit = units.get(event.unitId);
        if (unit) units.set(unit.id, { ...unit, dead: true });
        break;
      }
      case 'match-end':
        winner = event.winner;
        break;
      case 'tick':
      case 'attack':
      case 'cast':
        break;
    }
  }

  return {
    tick,
    version,
    seed,
    units: Array.from(units.values()),
    winner,
    tickEffects,
  };
}
