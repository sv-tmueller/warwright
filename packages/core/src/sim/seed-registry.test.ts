import { describe, expect, it } from 'vitest';
import { EXTERNAL_BEHAVIOR_ID } from './constants.js';
import { createSeedRegistry } from './seed-registry.js';

describe('createSeedRegistry', () => {
  it('registers the three seed Behaviors and resolves each by id', () => {
    const registry = createSeedRegistry();

    expect(registry.getBehavior('aggro-lowest-hp').id).toBe('aggro-lowest-hp');
    expect(registry.getBehavior('protect-allies').id).toBe('protect-allies');
    expect(registry.getBehavior('focus-casters').id).toBe('focus-casters');
  });

  it('has no behavior registered under the external sentinel id', () => {
    const registry = createSeedRegistry();

    expect(() => registry.getBehavior(EXTERNAL_BEHAVIOR_ID)).toThrow(
      `Unknown behavior id: ${EXTERNAL_BEHAVIOR_ID}`,
    );
  });
});
