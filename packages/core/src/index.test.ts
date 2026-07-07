import { describe, expect, it } from 'vitest';
import { behaviorIds, roles, skills } from './index.js';

describe('@warwright/core', () => {
  it('loads the package', () => {
    expect(true).toBe(true);
  });

  it('exposes the seed role enumeration', () => {
    expect(roles.map((role) => role.id)).toEqual(['vanguard', 'warden', 'reaver', 'mender']);
  });

  it('exposes the seed skill enumeration', () => {
    expect(skills.map((skill) => skill.id)).toEqual([
      'shield-bash',
      'guardian-ward',
      'cleave',
      'frost-bolt',
      'venom-shot',
      'mending-touch',
    ]);
  });

  it('exposes the seed behavior id enumeration', () => {
    expect(behaviorIds).toEqual(['aggro-lowest-hp', 'protect-allies', 'focus-casters']);
  });
});
