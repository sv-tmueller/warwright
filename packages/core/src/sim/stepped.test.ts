import { describe, expect, it } from 'vitest';
import warbandA from '../../../../builds/warband-a.json' with { type: 'json' };
import warbandB from '../../../../builds/warband-b.json' with { type: 'json' };
import type { Action } from './behavior.js';
import { MATCH_TICK_CAP } from './constants.js';
import { runMatch } from './match.js';
import type { Replay } from '../api/seams.js';
import { createSteppedMatch, EXTERNAL_BEHAVIOR_ID } from './stepped.js';

const VERSION = 1;
const SEED = 42;

const goldenReplay: Replay = { version: VERSION, seed: SEED, buildA: warbandA, buildB: warbandB };

// Same elimination fixture as match.test.ts: a single melee attacker per
// side, spawned already in range, using aggro-lowest-hp against a single
// enemy so targeting never ties and never draws from rng.
const eliminationReplay: Replay = {
  version: VERSION,
  seed: SEED,
  buildA: {
    name: 'Elimination A',
    units: [{ roleId: 'reaver', skillIds: [], behaviorId: 'aggro-lowest-hp', position: { x: 0, y: 0 } }],
  },
  buildB: {
    name: 'Elimination B',
    units: [{ roleId: 'mender', skillIds: [], behaviorId: 'aggro-lowest-hp', position: { x: 10, y: 0 } }],
  },
};

const stalemateReplay: Replay = {
  version: VERSION,
  seed: SEED,
  buildA: {
    name: 'Stalemate A',
    units: [{ roleId: 'mender', skillIds: [], behaviorId: 'protect-allies', position: { x: 0, y: 0 } }],
  },
  buildB: {
    name: 'Stalemate B',
    units: [
      { roleId: 'mender', skillIds: [], behaviorId: 'protect-allies', position: { x: 999, y: 999 } },
    ],
  },
};

describe('createSteppedMatch', () => {
  describe('parity with runMatch', () => {
    it('produces the same winner, hash, and deep-equal event log as runMatch when stepped one tick at a time', () => {
      const expected = runMatch(goldenReplay);

      const match = createSteppedMatch(goldenReplay);
      while (!match.done()) {
        match.step(1);
      }
      const actual = match.result();

      expect(actual.winner).toBe(expected.winner);
      expect(actual.hash).toBe(expected.hash);
      expect(actual.eventLog).toEqual(expected.eventLog);
    });

    it('produces the same winner, hash, and deep-equal event log as runMatch when stepped in chunks of 7', () => {
      const expected = runMatch(goldenReplay);

      const match = createSteppedMatch(goldenReplay);
      while (!match.done()) {
        match.step(7);
      }
      const actual = match.result();

      expect(actual.winner).toBe(expected.winner);
      expect(actual.hash).toBe(expected.hash);
      expect(actual.eventLog).toEqual(expected.eventLog);
    });

    it('matches runMatch for an elimination replay that ends below the tick cap', () => {
      const expected = runMatch(eliminationReplay);

      const match = createSteppedMatch(eliminationReplay);
      match.step(MATCH_TICK_CAP);

      expect(match.result()).toEqual(expected);
    });

    it('matches runMatch for a stalemate replay that runs out the tick cap to a draw', () => {
      const expected = runMatch(stalemateReplay);

      const match = createSteppedMatch(stalemateReplay);
      match.step(MATCH_TICK_CAP);

      expect(match.result()).toEqual(expected);
    });

    it('is idempotent: step() and result() after done do not re-emit match-end or change the result', () => {
      const match = createSteppedMatch(eliminationReplay);
      match.step(MATCH_TICK_CAP);
      const first = match.result();
      // Snapshot the finalized state BEFORE the post-done step() calls below,
      // so the assertions compare against an independent copy rather than
      // the same cached MatchResult reference (which would trivially pass
      // even if a regression let stepTick run after done).
      const beforePostDoneSteps = structuredClone(first);

      match.step(1);
      match.step(50);
      const second = match.result();

      expect(second).toEqual(beforePostDoneSteps);
      expect(second.eventLog).toHaveLength(beforePostDoneSteps.eventLog.length);
      expect(second.winner).toBe(beforePostDoneSteps.winner);
      expect(second.hash).toBe(beforePostDoneSteps.hash);
      // No trailing `tick` (or any other) events leaked from the post-done
      // step() calls.
      const matchEndEvents = second.eventLog.filter((event) => event.kind === 'match-end');
      expect(matchEndEvents).toHaveLength(1);
    });

    it('a single step(MATCH_TICK_CAP) call reproduces the exact tick-cap/match-end/hash semantics of runMatch', () => {
      const expected = runMatch(goldenReplay);

      const match = createSteppedMatch(goldenReplay);
      match.step(MATCH_TICK_CAP);
      const actual = match.result();

      expect(actual).toEqual(expected);
    });
  });

  describe('external action injection', () => {
    const externalVsIdleReplay: Replay = {
      version: VERSION,
      seed: SEED,
      buildA: {
        name: 'External A',
        units: [
          { roleId: 'reaver', skillIds: [], behaviorId: EXTERNAL_BEHAVIOR_ID, position: { x: 0, y: 0 } },
        ],
      },
      buildB: {
        name: 'Target B',
        units: [
          { roleId: 'mender', skillIds: [], behaviorId: 'protect-allies', position: { x: 10, y: 0 } },
        ],
      },
    };

    function attackUnitZero(): ReadonlyMap<number, Action> {
      return new Map([[0, { kind: 'attack', targetId: 1 }]]);
    }

    it('produces identical event logs across two runs given the same scripted action map', () => {
      const first = createSteppedMatch(externalVsIdleReplay);
      while (!first.done()) {
        first.step(1, attackUnitZero());
      }

      const second = createSteppedMatch(externalVsIdleReplay);
      while (!second.done()) {
        second.step(1, attackUnitZero());
      }

      expect(second.result()).toEqual(first.result());
    });

    it('applies the injected action, resolving actual combat effects (attack + damage events)', () => {
      const match = createSteppedMatch(externalVsIdleReplay);
      const world = match.step(1, attackUnitZero());

      expect(world.eventLog).toContainEqual({ kind: 'attack', tick: 1, unitId: 0, targetId: 1 });
      expect(world.units[1]?.hp).toBeLessThan(world.units[1]?.maxHp ?? 0);
    });

    it('throws when a living external unit has no entry in the actions map for that step', () => {
      const match = createSteppedMatch(externalVsIdleReplay);

      expect(() => match.step(1, new Map())).toThrow(/external/i);
      expect(() => match.step(1)).toThrow(/external/i);
    });

    it('draws zero rng in the decide slot for an all-external match (no registered behavior is ever consulted)', () => {
      const allExternalReplay: Replay = {
        version: VERSION,
        seed: SEED,
        buildA: {
          name: 'All External A',
          units: [
            { roleId: 'reaver', skillIds: [], behaviorId: EXTERNAL_BEHAVIOR_ID, position: { x: 0, y: 0 } },
          ],
        },
        buildB: {
          name: 'All External B',
          units: [
            {
              roleId: 'mender',
              skillIds: [],
              behaviorId: EXTERNAL_BEHAVIOR_ID,
              position: { x: 10, y: 0 },
            },
          ],
        },
      };
      const idleBoth: ReadonlyMap<number, Action> = new Map([
        [0, { kind: 'idle' }],
        [1, { kind: 'idle' }],
      ]);

      const match = createSteppedMatch(allExternalReplay);
      // Neither unit is registered under any Behavior id at all (both use the
      // sentinel); if the decide slot ever fell through to
      // registry.getBehavior(), this would throw "Unknown behavior id:
      // external" instead of quietly idling.
      expect(() => match.step(10, idleBoth)).not.toThrow();
      expect(match.done()).toBe(false);
    });
  });
});
