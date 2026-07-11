import { roles, skills, type MatchEvent } from '@warwright/core';
import { MS_PER_TICK } from './playback.js';

// Structural types read off MatchEvent's variants rather than imported by
// name: core only exports the MatchEvent union from its public surface (see
// frame-state.ts and the sub-plan on issue #48/#52), not the per-variant
// event types individually.
type MatchStartEvent = Extract<MatchEvent, { kind: 'match-start' }>;
type SpawnInfo = MatchStartEvent['units'][number];

export type FeedEntry = {
  readonly index: number;
  readonly tick: number;
  readonly kind: MatchEvent['kind'];
  readonly text: string;
};

const ROLE_NAMES = new Map(roles.map((role) => [role.id, role.name]));
const SKILL_NAMES = new Map(skills.map((skill) => [skill.id, skill.name]));

function roleNameOf(roleId: string): string {
  return ROLE_NAMES.get(roleId) ?? roleId;
}

function skillNameOf(skillId: string): string {
  return SKILL_NAMES.get(skillId) ?? skillId;
}

function labelOf(spawn: SpawnInfo): string {
  return `${spawn.team}·${roleNameOf(spawn.roleId)}#${spawn.id}`;
}

// Feed text formats event fields only, no combat recomputation: hp comes
// verbatim from hpAfter, absorbed/magnitude/durationTicks are shown as-is
// (see CLAUDE.md's determinism contract and the sub-plan on issue #52).
function formatEntryText(
  event: MatchEvent,
  labelById: ReadonlyMap<number, string>,
): string | null {
  const labelFor = (id: number): string => labelById.get(id) ?? `#${id}`;

  switch (event.kind) {
    case 'match-start':
      return `Match start — seed ${event.seed}, ruleset v${event.version}`;
    case 'attack':
      return `${labelFor(event.unitId)} attacks ${labelFor(event.targetId)}`;
    case 'cast':
      return `${labelFor(event.unitId)} casts ${skillNameOf(event.skillId)} on ${labelFor(event.targetId)}`;
    case 'damage': {
      const absorbedSuffix = event.absorbed > 0 ? ` (${event.absorbed} absorbed)` : '';
      if (event.sourceId === null) {
        return `${labelFor(event.targetId)} takes ${event.amount} damage over time${absorbedSuffix}, hp ${event.hpAfter}`;
      }
      return `${labelFor(event.sourceId)} hits ${labelFor(event.targetId)} for ${event.amount}${absorbedSuffix}, hp ${event.hpAfter}`;
    }
    case 'heal':
      return `${labelFor(event.sourceId)} heals ${labelFor(event.targetId)} for ${event.amount}, hp ${event.hpAfter}`;
    case 'status-applied':
      return `${labelFor(event.targetId)} gains ${event.status} (magnitude ${event.magnitude}, ${event.durationTicks} ticks)`;
    case 'status-expired':
      return `${labelFor(event.targetId)} loses ${event.status}`;
    case 'death':
      return `${labelFor(event.unitId)} dies`;
    case 'match-end':
      return `Match ends — winner: ${event.winner}`;
    case 'tick':
    case 'move':
      return null;
  }
}

/**
 * Builds the readable event feed from a match's event log, in sim order.
 * `tick` and `move` events are excluded (lead decision, batch #89): tick is
 * one-per-tick noise and move would flood the feed. Every other kind
 * produces exactly one entry, formatted from that event's own fields only.
 */
export function buildFeed(eventLog: readonly MatchEvent[]): readonly FeedEntry[] {
  const labelById = new Map<number, string>();
  const entries: FeedEntry[] = [];

  for (const event of eventLog) {
    if (event.kind === 'match-start') {
      for (const spawn of event.units) {
        labelById.set(spawn.id, labelOf(spawn));
      }
    }

    const text = formatEntryText(event, labelById);
    if (text === null) continue;

    entries.push({ index: entries.length, tick: event.tick, kind: event.kind, text });
  }

  return entries;
}

/**
 * Index of the last feed entry with `tick <= target`, or -1 if none. This
 * is the entire sync mechanism between the (already-exact) playback tick
 * and the feed: a pure function of `(entries, tick)`. When `target` falls
 * on a tick with no feed events, the most recent prior entry's index is
 * returned, so a step or seek that lands between events still highlights
 * something sensible.
 */
export function feedIndexForTick(entries: readonly FeedEntry[], target: number): number {
  let result = -1;
  for (const entry of entries) {
    if (entry.tick > target) break;
    result = entry.index;
  }
  return result;
}

/**
 * Pure string formatting of a tick as sim time at 20 Hz. Produces no engine
 * value: this is display formatting only, derived from MS_PER_TICK (see
 * playback.ts), not a duplicated constant.
 */
export function formatTickTime(tick: number): string {
  const seconds = (tick * MS_PER_TICK) / 1000;
  return `t ${tick} · ${seconds.toFixed(2)}s`;
}
