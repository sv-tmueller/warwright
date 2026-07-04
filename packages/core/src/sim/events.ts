import type { StatusKind } from './vocab.js';
import type { Position, Winner } from './types.js';

export type SpawnInfo = {
  id: number;
  team: 'A' | 'B';
  roleId: string;
  pos: Position;
  hp: number;
  maxHp: number;
};

export type MatchStartEvent = {
  kind: 'match-start';
  tick: number;
  version: number;
  seed: number;
  units: SpawnInfo[];
};

export type TickEvent = {
  kind: 'tick';
  tick: number;
};

export type MoveEvent = {
  kind: 'move';
  tick: number;
  unitId: number;
  from: Position;
  to: Position;
};

export type AttackEvent = {
  kind: 'attack';
  tick: number;
  unitId: number;
  targetId: number;
};

export type CastEvent = {
  kind: 'cast';
  tick: number;
  unitId: number;
  skillId: string;
  targetId: number;
};

export type DamageEvent = {
  kind: 'damage';
  tick: number;
  // null for dot ticks: DotState carries no source.
  sourceId: number | null;
  targetId: number;
  amount: number;
  absorbed: number;
  hpAfter: number;
};

export type HealEvent = {
  kind: 'heal';
  tick: number;
  sourceId: number;
  targetId: number;
  amount: number;
  hpAfter: number;
};

export type StatusAppliedEvent = {
  kind: 'status-applied';
  tick: number;
  targetId: number;
  status: StatusKind;
  magnitude: number;
  durationTicks: number;
};

export type StatusExpiredEvent = {
  kind: 'status-expired';
  tick: number;
  targetId: number;
  status: StatusKind;
};

export type DeathEvent = {
  kind: 'death';
  tick: number;
  unitId: number;
};

export type MatchEndEvent = {
  kind: 'match-end';
  tick: number;
  winner: Winner;
};

export type MatchEvent =
  | MatchStartEvent
  | TickEvent
  | MoveEvent
  | AttackEvent
  | CastEvent
  | DamageEvent
  | HealEvent
  | StatusAppliedEvent
  | StatusExpiredEvent
  | DeathEvent
  | MatchEndEvent;

export const EVENT_KINDS = [
  'match-start',
  'tick',
  'move',
  'attack',
  'cast',
  'damage',
  'heal',
  'status-applied',
  'status-expired',
  'death',
  'match-end',
] as const;

// Compile-time check that EVENT_KINDS and MatchEvent['kind'] cannot drift.
type _EventKindsMatchUnion = (typeof EVENT_KINDS)[number] extends MatchEvent['kind']
  ? MatchEvent['kind'] extends (typeof EVENT_KINDS)[number]
    ? true
    : false
  : false;
const _eventKindsMatchUnion: _EventKindsMatchUnion = true;
void _eventKindsMatchUnion;

export function emit(log: MatchEvent[], event: MatchEvent): void {
  log.push(event);
}
