import { describe, expect, it } from 'vitest';
import { MATCH_TICK_CAP } from './constants.js';
import { runMatch } from './match.js';

const VERSION = 1;
const SEED = 42;

// A single melee attacker per side, spawned already in range of each other
// so combat starts on tick 1 without needing any movement: reaver (22 dmg,
// 3 armor, 900 rangeSquared) versus mender (4 dmg, 1 armor, 40000
// rangeSquared, 80 hp). Both use aggro-lowest-hp against a single enemy, so
// targeting never ties and never draws from rng.
const eliminationBuildA = {
  name: 'Elimination A',
  units: [
    {
      roleId: 'reaver',
      skillIds: [],
      behaviorId: 'aggro-lowest-hp',
      position: { x: 0, y: 0 },
    },
  ],
};

const eliminationBuildB = {
  name: 'Elimination B',
  units: [
    {
      roleId: 'mender',
      skillIds: [],
      behaviorId: 'aggro-lowest-hp',
      position: { x: 10, y: 0 },
    },
  ],
};

// Single-unit warbands using protect-allies: with no ally to move toward,
// decide() always returns idle, so neither side ever attacks or moves and
// the match must exhaust the tick cap.
const stalemateBuildA = {
  name: 'Stalemate A',
  units: [
    {
      roleId: 'mender',
      skillIds: [],
      behaviorId: 'protect-allies',
      position: { x: 0, y: 0 },
    },
  ],
};

const stalemateBuildB = {
  name: 'Stalemate B',
  units: [
    {
      roleId: 'mender',
      skillIds: [],
      behaviorId: 'protect-allies',
      position: { x: 999, y: 999 },
    },
  ],
};

describe('runMatch', () => {
  it('reaches a deterministic non-draw winner via elimination', () => {
    const result = runMatch({
      version: VERSION,
      seed: SEED,
      buildA: eliminationBuildA,
      buildB: eliminationBuildB,
    });

    expect(result.winner).not.toBe('draw');
    expect(result.version).toBe(VERSION);
    expect(result.seed).toBe(SEED);
  });

  it('produces deep-equal results (including eventLog and hash) for two identical runs', () => {
    const first = runMatch({
      version: VERSION,
      seed: SEED,
      buildA: eliminationBuildA,
      buildB: eliminationBuildB,
    });
    const second = runMatch({
      version: VERSION,
      seed: SEED,
      buildA: eliminationBuildA,
      buildB: eliminationBuildB,
    });

    expect(second).toEqual(first);
  });

  it('elimination ends with death events for the losing side and a terminal match-end below the tick cap', () => {
    const result = runMatch({
      version: VERSION,
      seed: SEED,
      buildA: eliminationBuildA,
      buildB: eliminationBuildB,
    });

    expect(result.winner).toBe('A');

    const losingUnitId = 1; // buildB's sole unit: id 1 (buildA's unit takes id 0).
    expect(result.eventLog).toContainEqual({
      kind: 'death',
      tick: expect.any(Number),
      unitId: losingUnitId,
    });

    const lastEvent = result.eventLog.at(-1);
    expect(lastEvent).toEqual({ kind: 'match-end', tick: expect.any(Number), winner: 'A' });
    expect(lastEvent && 'tick' in lastEvent ? lastEvent.tick : -1).toBeLessThan(MATCH_TICK_CAP);
  });

  it('ends winner: "draw" at tick === MATCH_TICK_CAP when neither side ever engages', () => {
    const result = runMatch({
      version: VERSION,
      seed: SEED,
      buildA: stalemateBuildA,
      buildB: stalemateBuildB,
    });

    expect(result.winner).toBe('draw');
    expect(result.eventLog).toContainEqual({
      kind: 'match-end',
      tick: MATCH_TICK_CAP,
      winner: 'draw',
    });
  });
});
