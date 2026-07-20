import { describe, expect, it } from 'vitest';
import {
  behaviorIds,
  createSteppedMatch,
  EXTERNAL_BEHAVIOR_ID,
  policySmokeV1,
  roles,
  skills,
} from './index.js';

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
    expect(behaviorIds).toEqual([
      'aggro-lowest-hp',
      'protect-allies',
      'focus-casters',
      'policy-smoke-v1',
    ]);
  });

  it('excludes the external sentinel from the public behaviorIds enumeration', () => {
    expect(behaviorIds).not.toContain(EXTERNAL_BEHAVIOR_ID);
  });

  it('exposes the external sentinel id and the stepped-match factory', () => {
    expect(EXTERNAL_BEHAVIOR_ID).toBe('external');
    expect(typeof createSteppedMatch).toBe('function');
  });

  it('exposes the policySmokeV1 Behavior so an exported-policy submission can reuse it under a new id', () => {
    expect(policySmokeV1.id).toBe('policy-smoke-v1');
    expect(typeof policySmokeV1.decide).toBe('function');
  });
});
