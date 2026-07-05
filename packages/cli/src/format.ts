import type { MatchEvent } from '@warwright/core';

// One line per event, tagged with its own tick. Bare `tick` events carry no
// information beyond the tick counter and are skipped to keep the printed
// log short (see CLAUDE.md determinism contract: ticks drive the sim, not
// wall-clock time; this is purely a presentation choice over the log).
export function formatEventLog(log: readonly MatchEvent[]): string[] {
  const lines: string[] = [];

  for (const event of log) {
    switch (event.kind) {
      case 'match-start':
        lines.push(
          `t${event.tick} match-start version=${event.version} seed=${event.seed} units=${event.units.length}`,
        );
        break;
      case 'tick':
        break;
      case 'move':
        lines.push(
          `t${event.tick} move unit=${event.unitId} from=(${event.from.x},${event.from.y}) to=(${event.to.x},${event.to.y})`,
        );
        break;
      case 'attack':
        lines.push(`t${event.tick} attack unit=${event.unitId} -> target=${event.targetId}`);
        break;
      case 'cast':
        lines.push(
          `t${event.tick} cast unit=${event.unitId} skill=${event.skillId} -> target=${event.targetId}`,
        );
        break;
      case 'damage': {
        const source = event.sourceId === null ? 'dot' : event.sourceId;
        lines.push(
          `t${event.tick} damage source=${source} -> target=${event.targetId} amount=${event.amount} absorbed=${event.absorbed} hp=${event.hpAfter}`,
        );
        break;
      }
      case 'heal':
        lines.push(
          `t${event.tick} heal source=${event.sourceId} -> target=${event.targetId} amount=${event.amount} hp=${event.hpAfter}`,
        );
        break;
      case 'status-applied':
        lines.push(
          `t${event.tick} status-applied target=${event.targetId} status=${event.status} magnitude=${event.magnitude} duration=${event.durationTicks}`,
        );
        break;
      case 'status-expired':
        lines.push(`t${event.tick} status-expired target=${event.targetId} status=${event.status}`);
        break;
      case 'death':
        lines.push(`t${event.tick} death unit=${event.unitId}`);
        break;
      case 'match-end':
        lines.push(`t${event.tick} match-end winner=${event.winner}`);
        break;
    }
  }

  return lines;
}
