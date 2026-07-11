import { formatTickTime } from './event-feed.js';
import type { FrameState, FrameUnit } from './frame-state.js';

export type HudProps = {
  readonly frame: FrameState;
  readonly speed: number;
  readonly lastTick: number;
  readonly buildAName: string;
  readonly buildBName: string;
};

// Straight `Array.filter` by team off frame.units, per the sub-plan on issue
// #52: no derivation logic beyond that. hp/dead/statuses are display-only,
// read verbatim from the already-derived FrameState (deriveFrame's hp comes
// from hpAfter, statuses from applied/expired pairs - see frame-state.ts).
function UnitRow({ unit }: { readonly unit: FrameUnit }) {
  const statusKeys = Object.keys(unit.statuses);
  return (
    <li>
      {unit.roleId}#{unit.id} — {unit.dead ? 'dead' : `${unit.hp}/${unit.maxHp} hp`}
      {statusKeys.length > 0 ? ` [${statusKeys.join(', ')}]` : ''}
    </li>
  );
}

/**
 * Thin, untested-by-convention component (see the sub-plan on issue #52):
 * every value it renders is either read verbatim off FrameState (tick,
 * version, seed, units, winner - all log-derived) or passed straight
 * through from playback state (speed) or the validated warband inputs
 * (build names). No combat recomputation happens here.
 */
export function Hud({ frame, speed, lastTick, buildAName, buildBName }: HudProps) {
  const teamA = frame.units.filter((unit) => unit.team === 'A');
  const teamB = frame.units.filter((unit) => unit.team === 'B');

  return (
    <section>
      <h3>HUD</h3>
      <div>
        {formatTickTime(frame.tick)} / {lastTick}
      </div>
      <div>Speed: {speed}x</div>
      <div>
        Seed: {frame.seed ?? '—'} · Ruleset v{frame.version ?? '—'}
      </div>
      {frame.winner !== null && <div>Winner: {frame.winner}</div>}
      <div>
        <h4>{buildAName}</h4>
        <ul>
          {teamA.map((unit) => (
            <UnitRow key={unit.id} unit={unit} />
          ))}
        </ul>
      </div>
      <div>
        <h4>{buildBName}</h4>
        <ul>
          {teamB.map((unit) => (
            <UnitRow key={unit.id} unit={unit} />
          ))}
        </ul>
      </div>
    </section>
  );
}
