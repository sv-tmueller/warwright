import { describe, expect, it } from 'vitest';
import { OBS_ENCODING_VERSION } from '../../../sim/observation.js';
import { parsePolicyWeights, policySmokeV1Weights } from './weights-schema.js';

function validWeights(): unknown {
  return {
    formatVersion: 1,
    behaviorId: 'policy-smoke-v1',
    obsEncodingVersion: OBS_ENCODING_VERSION,
    obsDim: 3,
    nvec: [2, 3],
    hidden: [4, 5],
    trunk1: {
      weight: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      bias: [0, 0, 0, 0],
    },
    trunk2: {
      weight: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      bias: [0, 0, 0, 0, 0],
    },
    actorHead: {
      weight: [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ],
      bias: [0, 0, 0, 0, 0],
    },
  };
}

describe('parsePolicyWeights', () => {
  it('parses a well-formed weights object matching its own declared shapes', () => {
    const weights = parsePolicyWeights(validWeights());
    expect(weights.obsDim).toBe(3);
    expect(weights.nvec).toEqual([2, 3]);
    expect(weights.hidden).toEqual([4, 5]);
  });

  it('fails loud when trunk1.weight row count does not match hidden[0]', () => {
    const data = validWeights() as { trunk1: { weight: number[][] } };
    data.trunk1.weight.pop();
    expect(() => parsePolicyWeights(data)).toThrow(/trunk1/);
  });

  it('fails loud when trunk1.weight column count does not match obsDim', () => {
    const data = validWeights() as { trunk1: { weight: number[][] } };
    data.trunk1.weight[0]!.pop();
    expect(() => parsePolicyWeights(data)).toThrow(/trunk1/);
  });

  it('fails loud when trunk1.bias length does not match hidden[0]', () => {
    const data = validWeights() as { trunk1: { bias: number[] } };
    data.trunk1.bias.pop();
    expect(() => parsePolicyWeights(data)).toThrow(/trunk1/);
  });

  it('fails loud when trunk2.weight shape does not match hidden[1] x hidden[0]', () => {
    const data = validWeights() as { trunk2: { weight: number[][] } };
    data.trunk2.weight.pop();
    expect(() => parsePolicyWeights(data)).toThrow(/trunk2/);
  });

  it('fails loud when actorHead.weight row count does not match sum(nvec)', () => {
    const data = validWeights() as { actorHead: { weight: number[][] } };
    data.actorHead.weight.pop();
    expect(() => parsePolicyWeights(data)).toThrow(/actorHead/);
  });

  it('fails loud when actorHead.bias length does not match sum(nvec)', () => {
    const data = validWeights() as { actorHead: { bias: number[] } };
    data.actorHead.bias.pop();
    expect(() => parsePolicyWeights(data)).toThrow(/actorHead/);
  });

  it('fails loud when obsEncodingVersion does not match the running OBS_ENCODING_VERSION', () => {
    const data = validWeights() as { obsEncodingVersion: number };
    data.obsEncodingVersion = OBS_ENCODING_VERSION + 1;
    expect(() => parsePolicyWeights(data)).toThrow(/obsEncodingVersion/);
  });

  it('fails loud on a structurally invalid object (Zod validation)', () => {
    expect(() => parsePolicyWeights({})).toThrow();
  });

  it('fails loud when formatVersion is not the pinned literal 1 (e.g. a future format-2 export)', () => {
    const data = validWeights() as { formatVersion: number };
    data.formatVersion = 2;
    expect(() => parsePolicyWeights(data)).toThrow();
  });
});

describe('policySmokeV1Weights (the committed artifact, validated at module load)', () => {
  it('is the committed policy-smoke-v1 weights, matching the parity fixture contract', () => {
    expect(policySmokeV1Weights.behaviorId).toBe('policy-smoke-v1');
    expect(policySmokeV1Weights.obsEncodingVersion).toBe(OBS_ENCODING_VERSION);
    expect(policySmokeV1Weights.obsDim).toBe(17);
    expect(policySmokeV1Weights.nvec).toEqual([5, 1, 6, 1001, 1001]);
    expect(policySmokeV1Weights.hidden).toEqual([64, 64]);
  });
});
