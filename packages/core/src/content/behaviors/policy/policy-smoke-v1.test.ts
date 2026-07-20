// Wiring tests use a small SYNTHETIC PolicyWeights (obsDim matching this
// repo's real self-block + 1-unit-block layout, so a real observationOf
// vector is valid input, but tiny nvec/hidden sizes so the argmax outcome
// for each action kind can be forced deterministically via bias-only
// actorHead logits -- see inference.test.ts's weightsWithBiasOnlyLogits for
// the same pattern). The real committed policySmokeV1Weights is exercised
// separately by inference-parity.test.ts (67/67 argmax cases) and by the
// match-integration test (index.test.ts / the demo builds).
import { describe, expect, it } from 'vitest';
import type { Rng } from '../../../sim/prng.js';
import type { UnitView, WorldView } from '../../../sim/behavior.js';
import {
  OBS_SELF_FIELD_COUNT,
  OBS_UNIT_FIELD_COUNT,
  OBS_UNIT_ID_OFFSET,
} from '../../../sim/observation.js';
import { createPolicySmokeV1Decide, policySmokeV1 } from './policy-smoke-v1.js';
import type { PolicyWeights } from './weights-schema.js';

const OBS_DIM = OBS_SELF_FIELD_COUNT + OBS_UNIT_FIELD_COUNT; // self block + one enemy block

function throwingRng(): Rng {
  return {
    next: () => {
      throw new Error('rng.next should not be called: policy-smoke-v1 draws no RNG');
    },
    float: () => {
      throw new Error('rng.float should not be called: policy-smoke-v1 draws no RNG');
    },
  };
}

function selfView(id: number): UnitView {
  return {
    id,
    team: 'A',
    roleId: 'reaver',
    hp: 100,
    maxHp: 100,
    pos: { x: 0, y: 0 },
    skills: [{ skillId: 'cleave', cooldownRemaining: 0 }],
    attackRangeSquared: 400,
  };
}

// A raw observation whose single enemy target slot's id is `enemyId`,
// otherwise all zeros (structurally valid: self block then one unit block).
function observationWithEnemyId(enemyId: number): number[] {
  const obs = new Array<number>(OBS_DIM).fill(0);
  obs[OBS_SELF_FIELD_COUNT + OBS_UNIT_ID_OFFSET] = enemyId;
  return obs;
}

function worldWithObservation(observation: readonly number[]): WorldView {
  return {
    alliesOf: () => {
      throw new Error('alliesOf should never be read by policy-smoke-v1');
    },
    enemiesOf: () => {
      throw new Error('enemiesOf should never be read by policy-smoke-v1');
    },
    observationOf: () => observation,
  };
}

// nvec = [kind(5), targetSlot(1), skillIndex(6), moveX(3), moveY(3)] -- small
// move/skill ranges are fine for wiring tests (decodeAction does not bounds
// -check coordinates or skill index range beyond the real skill catalog
// length, which stays 6 to match production).
function weightsForcingLogits(bias: readonly number[]): PolicyWeights {
  const hidden: [number, number] = [1, 1];
  return {
    formatVersion: 1,
    behaviorId: 'policy-smoke-v1',
    obsEncodingVersion: 1,
    obsDim: OBS_DIM,
    nvec: [5, 1, 6, 3, 3],
    hidden,
    trunk1: { weight: [new Array<number>(OBS_DIM).fill(0)], bias: [0] },
    trunk2: { weight: [[0]], bias: [0] },
    actorHead: { weight: bias.map(() => [0]), bias: [...bias] },
  };
}

// [kind(5), targetSlot(1), skillIndex(6), moveX(3), moveY(3)]: bias-only
// logits, so the winning index within each segment is just the segment's
// argmax of these literal numbers.
function biasFor({
  kind,
  skillIndex = 0,
  moveX = 0,
  moveY = 0,
}: {
  kind: number;
  skillIndex?: number;
  moveX?: number;
  moveY?: number;
}): number[] {
  const kindLogits = [0, 0, 0, 0, 0];
  kindLogits[kind] = 10;
  const targetSlotLogits = [0];
  const skillLogits = [0, 0, 0, 0, 0, 0];
  skillLogits[skillIndex] = 10;
  const moveXLogits = [0, 0, 0];
  moveXLogits[moveX] = 10;
  const moveYLogits = [0, 0, 0];
  moveYLogits[moveY] = 10;
  return [...kindLogits, ...targetSlotLogits, ...skillLogits, ...moveXLogits, ...moveYLogits];
}

describe('policySmokeV1', () => {
  it('has the expected id', () => {
    expect(policySmokeV1.id).toBe('policy-smoke-v1');
  });

  it('draws no RNG', () => {
    const weights = weightsForcingLogits(biasFor({ kind: 0 }));
    const decide = createPolicySmokeV1Decide(weights);
    const world = worldWithObservation(observationWithEnemyId(7));
    expect(() => decide(selfView(1), world, throwingRng())).not.toThrow();
  });

  it('throws a clear, roster-shape-specific error when the observation length does not match obsDim', () => {
    const weights = weightsForcingLogits(biasFor({ kind: 0 }));
    const decide = createPolicySmokeV1Decide(weights);
    const world = worldWithObservation([0, 0, 0]); // wrong length
    expect(() => decide(selfView(1), world, throwingRng())).toThrow(/obsDim/);
  });

  it('maps action kind 0 (idle) to Action { kind: "idle" }', () => {
    const weights = weightsForcingLogits(biasFor({ kind: 0 }));
    const decide = createPolicySmokeV1Decide(weights);
    const world = worldWithObservation(observationWithEnemyId(7));
    expect(decide(selfView(1), world, throwingRng())).toEqual({ kind: 'idle' });
  });

  it('maps action kind 1 (move) to Action { kind: "move", to: {x, y} } using the moveX/moveY components directly', () => {
    const weights = weightsForcingLogits(biasFor({ kind: 1, moveX: 2, moveY: 1 }));
    const decide = createPolicySmokeV1Decide(weights);
    const world = worldWithObservation(observationWithEnemyId(7));
    expect(decide(selfView(1), world, throwingRng())).toEqual({ kind: 'move', to: { x: 2, y: 1 } });
  });

  it('maps action kind 2 (move-toward) to the enemy id read from the obs unit block at the chosen target slot', () => {
    const weights = weightsForcingLogits(biasFor({ kind: 2 }));
    const decide = createPolicySmokeV1Decide(weights);
    const world = worldWithObservation(observationWithEnemyId(42));
    expect(decide(selfView(1), world, throwingRng())).toEqual({ kind: 'move-toward', targetId: 42 });
  });

  it('maps action kind 3 (attack) to the enemy id read from the obs unit block at the chosen target slot', () => {
    const weights = weightsForcingLogits(biasFor({ kind: 3 }));
    const decide = createPolicySmokeV1Decide(weights);
    const world = worldWithObservation(observationWithEnemyId(42));
    expect(decide(selfView(1), world, throwingRng())).toEqual({ kind: 'attack', targetId: 42 });
  });

  it('maps action kind 4 (cast) to the enemy id and the skill catalog id at the chosen skillIndex', () => {
    const weights = weightsForcingLogits(biasFor({ kind: 4, skillIndex: 2 }));
    const decide = createPolicySmokeV1Decide(weights);
    const world = worldWithObservation(observationWithEnemyId(42));
    // skillIndex 2 in the real skill catalog order (see sim/observation.ts) is 'cleave'.
    expect(decide(selfView(1), world, throwingRng())).toEqual({
      kind: 'cast',
      skillId: 'cleave',
      targetId: 42,
    });
  });

  it('is deterministic: identical inputs yield identical actions', () => {
    const weights = weightsForcingLogits(biasFor({ kind: 3 }));
    const decide = createPolicySmokeV1Decide(weights);
    const world = worldWithObservation(observationWithEnemyId(42));
    const first = decide(selfView(1), world, throwingRng());
    const second = decide(selfView(1), world, throwingRng());
    expect(first).toEqual(second);
  });
});
