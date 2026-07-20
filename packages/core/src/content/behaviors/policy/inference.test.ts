// Uses synthetic (non-committed) weights shaped like a real observation
// (obsDim=17, one self block + one enemy block, matching this repo's real
// OBS_SELF_FIELD_COUNT/OBS_UNIT_FIELD_COUNT) so featurize doesn't throw, but
// deliberately small/hand-traceable trunks so expected outputs can be
// derived directly from detTanh + plain arithmetic (not by re-implementing
// inferActionComponents' own algorithm in the test).
import { describe, expect, it } from 'vitest';
import type { PolicyWeights } from './weights-schema.js';
import { computeActorLogits, inferActionComponents } from './inference.js';
import { detTanh } from './tanh.js';

const OBS_DIM = 17; // self block (11, with this repo's 6-skill catalog) + 1 unit block (6)

function zerosObservation(): number[] {
  return new Array<number>(OBS_DIM).fill(0);
}

function weightsWithBiasOnlyLogits(nvec: readonly number[], bias: readonly number[]): PolicyWeights {
  const hidden: [number, number] = [1, 1];
  return {
    formatVersion: 1,
    behaviorId: 'test-policy',
    obsEncodingVersion: 1,
    obsDim: OBS_DIM,
    nvec: [...nvec],
    hidden,
    trunk1: { weight: [new Array<number>(OBS_DIM).fill(0)], bias: [0] },
    trunk2: { weight: [[0]], bias: [0] },
    actorHead: {
      weight: bias.map(() => [0]),
      bias: [...bias],
    },
  };
}

describe('inferActionComponents', () => {
  it('throws when the observation length does not match obsDim', () => {
    const weights = weightsWithBiasOnlyLogits([2], [0, 0]);
    expect(() => inferActionComponents(weights, [0, 0, 0])).toThrow(/obsDim/);
  });

  it('picks the argmax index within each nvec segment, in nvec order', () => {
    // Trunk collapses to h2 = tanh(0) = 0 exactly (all-zero weights/biases),
    // so actorHead weight*0 vanishes and logits are exactly actorHead.bias
    // -- fully hand-verifiable without touching the trunk math.
    const weights = weightsWithBiasOnlyLogits([2, 3], [5, 5, 1, 9, 1]);
    const observation = zerosObservation();

    expect(inferActionComponents(weights, observation)).toEqual([0, 1]);
  });

  it('breaks an exact tie with the LOWEST index (strict > first-max-wins)', () => {
    const weights = weightsWithBiasOnlyLogits([4], [3, 7, 7, 2]);
    const observation = zerosObservation();

    expect(inferActionComponents(weights, observation)).toEqual([1]);
  });

  it('runs the full trunk1 -> tanh -> trunk2 -> tanh -> actorHead pipeline correctly', () => {
    // trunk1 reads only the self-block hp feature (index 0, featurized to
    // exactly 1.0 for a raw hp of 1024): h1 = tanh(1*1.0 + 0) = detTanh(1).
    const hidden: [number, number] = [1, 1];
    const weights: PolicyWeights = {
      formatVersion: 1,
      behaviorId: 'test-policy',
      obsEncodingVersion: 1,
      obsDim: OBS_DIM,
      nvec: [2],
      hidden,
      trunk1: { weight: [[1, ...new Array<number>(OBS_DIM - 1).fill(0)]], bias: [0] },
      trunk2: { weight: [[2]], bias: [0] },
      actorHead: { weight: [[3], [-1]], bias: [0, 0] },
    };
    const observation = zerosObservation();
    observation[0] = 1024; // OBS_SELF_HP_INDEX; featurize divides by HP_DIVISOR=1024 -> 1.0

    const h1 = detTanh(1 * 1.0 + 0);
    const h2 = detTanh(2 * h1 + 0);
    const expectedLogits = [3 * h2 + 0, -1 * h2 + 0];

    expect(computeActorLogits(weights, observation)).toEqual(expectedLogits);
    expect(inferActionComponents(weights, observation)).toEqual([expectedLogits[0]! > expectedLogits[1]! ? 0 : 1]);
  });

  it('is deterministic: identical inputs yield identical outputs', () => {
    const weights = weightsWithBiasOnlyLogits([2, 3], [5, 5, 1, 9, 1]);
    const observation = zerosObservation();

    const first = inferActionComponents(weights, observation);
    const second = inferActionComponents(weights, observation);
    expect(first).toEqual(second);
  });
});
