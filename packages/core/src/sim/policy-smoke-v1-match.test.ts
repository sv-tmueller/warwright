// Match-integration coverage for the policy-smoke-v1 exported inference
// Behavior (#66): a full runMatch on its demo build pair (mirroring
// gym/warwright_gym/training/smoke_run.py's training build pair) completes
// without throwing, and two runs with the same seed produce a deep-equal
// event log -- the same determinism bar every other Behavior meets.
import { describe, expect, it } from 'vitest';
import policyBuildA from '../../../../builds/policy-1v1-a.json' with { type: 'json' };
import policyBuildB from '../../../../builds/policy-1v1-b.json' with { type: 'json' };
import { RULESET_VERSION } from './constants.js';
import { runMatch } from './match.js';

const SEED = 42;

describe('policy-smoke-v1 demo match', () => {
  it('completes a full match on the demo build pair without throwing', () => {
    expect(() =>
      runMatch({ version: RULESET_VERSION, seed: SEED, buildA: policyBuildA, buildB: policyBuildB }),
    ).not.toThrow();
  });

  it('reaches a decisive (non-draw) winner within the tick cap', () => {
    const result = runMatch({
      version: RULESET_VERSION,
      seed: SEED,
      buildA: policyBuildA,
      buildB: policyBuildB,
    });
    expect(['A', 'B']).toContain(result.winner);
  });

  it('produces a deep-equal event log across two runs with the same seed and builds', () => {
    const first = runMatch({
      version: RULESET_VERSION,
      seed: SEED,
      buildA: policyBuildA,
      buildB: policyBuildB,
    });
    const second = runMatch({
      version: RULESET_VERSION,
      seed: SEED,
      buildA: policyBuildA,
      buildB: policyBuildB,
    });

    expect(second.eventLog).toEqual(first.eventLog);
    expect(second.winner).toBe(first.winner);
  });
});
