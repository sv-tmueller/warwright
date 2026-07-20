import { describe, expect, it } from 'vitest';
import { createContentRegistry } from '../registry.js';
import { aggroLowestHp, focusCasters, policySmokeV1, protectAllies } from './index.js';

describe('content/behaviors index', () => {
  it('exports behaviors with the expected ids', () => {
    expect(aggroLowestHp.id).toBe('aggro-lowest-hp');
    expect(protectAllies.id).toBe('protect-allies');
    expect(focusCasters.id).toBe('focus-casters');
    expect(policySmokeV1.id).toBe('policy-smoke-v1');
  });

  it('registers each behavior on a fresh registry without throwing', () => {
    const registry = createContentRegistry();
    expect(() => registry.registerBehavior(aggroLowestHp)).not.toThrow();
    expect(() => registry.registerBehavior(protectAllies)).not.toThrow();
    expect(() => registry.registerBehavior(focusCasters)).not.toThrow();
    expect(() => registry.registerBehavior(policySmokeV1)).not.toThrow();
  });
});
