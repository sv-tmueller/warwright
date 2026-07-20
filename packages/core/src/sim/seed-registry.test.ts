import { describe, expect, it } from 'vitest';
import type { Behavior } from './behavior.js';
import { EXTERNAL_BEHAVIOR_ID } from './constants.js';
import { createSeedRegistry, createSeedRegistryWith } from './seed-registry.js';

describe('createSeedRegistry', () => {
  it('registers the seed Behaviors and resolves each by id', () => {
    const registry = createSeedRegistry();

    expect(registry.getBehavior('aggro-lowest-hp').id).toBe('aggro-lowest-hp');
    expect(registry.getBehavior('protect-allies').id).toBe('protect-allies');
    expect(registry.getBehavior('focus-casters').id).toBe('focus-casters');
    expect(registry.getBehavior('policy-smoke-v1').id).toBe('policy-smoke-v1');
  });

  it('has no behavior registered under the external sentinel id', () => {
    const registry = createSeedRegistry();

    expect(() => registry.getBehavior(EXTERNAL_BEHAVIOR_ID)).toThrow(
      `Unknown behavior id: ${EXTERNAL_BEHAVIOR_ID}`,
    );
  });
});

describe('createSeedRegistryWith', () => {
  const trivialBehavior: Behavior = {
    id: 'trivial-idle',
    decide: () => ({ kind: 'idle' }),
  };

  it('is equivalent to createSeedRegistry when given no extras', () => {
    const registry = createSeedRegistryWith([]);

    expect(registry.getBehavior('aggro-lowest-hp').id).toBe('aggro-lowest-hp');
    expect(registry.getBehavior('protect-allies').id).toBe('protect-allies');
    expect(registry.getBehavior('focus-casters').id).toBe('focus-casters');
    expect(registry.getBehavior('policy-smoke-v1').id).toBe('policy-smoke-v1');
  });

  it('registers extra Behaviors in addition to the seed set', () => {
    const registry = createSeedRegistryWith([trivialBehavior]);

    expect(registry.getBehavior('trivial-idle').id).toBe('trivial-idle');
    expect(registry.getBehavior('aggro-lowest-hp').id).toBe('aggro-lowest-hp');
  });

  it('throws loud when an extra Behavior id collides with a seed id (extras register after seed ids)', () => {
    const colliding: Behavior = { id: 'aggro-lowest-hp', decide: () => ({ kind: 'idle' }) };

    expect(() => createSeedRegistryWith([colliding])).toThrow(
      'Duplicate behavior id: aggro-lowest-hp',
    );
  });
});
