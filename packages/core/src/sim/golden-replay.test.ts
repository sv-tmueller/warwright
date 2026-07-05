import { describe, expect, it } from 'vitest';
import warbandA from '../../../../builds/warband-a.json' with { type: 'json' };
import warbandB from '../../../../builds/warband-b.json' with { type: 'json' };
import { RULESET_VERSION } from './constants.js';
import { hashEventLog } from './hash.js';
import { runMatch } from './match.js';
import golden from './__snapshots__/golden.json' with { type: 'json' };

const SEED = 42;

describe('golden replay', () => {
  it('matches the committed golden hash for the sample builds', () => {
    const result = runMatch({ version: RULESET_VERSION, seed: SEED, buildA: warbandA, buildB: warbandB });

    expect({ version: result.version, seed: result.seed, hash: hashEventLog(result.eventLog) }).toEqual(
      golden,
    );
  });

  it('produces a deep-equal event log across two runs with the same seed and builds', () => {
    const first = runMatch({ version: RULESET_VERSION, seed: SEED, buildA: warbandA, buildB: warbandB });
    const second = runMatch({ version: RULESET_VERSION, seed: SEED, buildA: warbandA, buildB: warbandB });

    expect(second.eventLog).toEqual(first.eventLog);
  });
});
