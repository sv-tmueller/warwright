import { describe, expect, it } from 'vitest';
import { EXTERNAL_BEHAVIOR_ID } from '@warwright/core';
import { parseSubmissionManifest } from './manifest.js';

const validManifest = {
  id: 'sample-aggro',
  author: 'foundry-fixtures',
  entry: 'behavior.ts',
  build: {
    roleId: 'reaver',
    skillIds: ['cleave'],
    position: { x: 0, y: 0 },
  },
  shape: 'general',
};

describe('parseSubmissionManifest (stage 1)', () => {
  it('accepts a valid manifest whose id matches the submission directory name', () => {
    const manifest = parseSubmissionManifest('sample-aggro', validManifest);

    expect(manifest.id).toBe('sample-aggro');
    expect(manifest.build.roleId).toBe('reaver');
    expect(manifest.shape).toBe('general');
  });

  it('rejects a manifest missing a required field, with the Zod message surfaced', () => {
    const missingEntry: Record<string, unknown> = { ...validManifest };
    delete missingEntry.entry;

    expect(() => parseSubmissionManifest('sample-aggro', missingEntry)).toThrow(/entry/i);
  });

  it('rejects a manifest with the wrong shape', () => {
    const bad = { ...validManifest, shape: 'duel' };

    expect(() => parseSubmissionManifest('sample-aggro', bad)).toThrow(/stage 1 \(manifest\)/i);
  });

  it('rejects when the manifest id does not match the submission directory name', () => {
    expect(() => parseSubmissionManifest('some-other-dir', validManifest)).toThrow(
      /directory name/i,
    );
  });

  it('rejects when the manifest id collides with an already-registered seed Behavior id', () => {
    const colliding = { ...validManifest, id: 'aggro-lowest-hp' };

    expect(() => parseSubmissionManifest('aggro-lowest-hp', colliding)).toThrow(
      /seed Behavior id/i,
    );
  });

  it('rejects a manifest whose build.roleId is not a core role', () => {
    const bad = { ...validManifest, build: { ...validManifest.build, roleId: 'not-a-role' } };

    expect(() => parseSubmissionManifest('sample-aggro', bad)).toThrow(/stage 1/i);
    expect(() => parseSubmissionManifest('sample-aggro', bad)).toThrow(/roleId/i);
  });

  it('rejects a manifest whose build.skillIds contains an unknown skill', () => {
    const bad = {
      ...validManifest,
      build: { ...validManifest.build, skillIds: ['cleave', 'not-a-skill'] },
    };

    expect(() => parseSubmissionManifest('sample-aggro', bad)).toThrow(/stage 1/i);
    expect(() => parseSubmissionManifest('sample-aggro', bad)).toThrow(/skillIds/i);
  });

  it('rejects a manifest that still declares a "baseline" field: the gauntlet\'s opponent Behavior is gate-pinned, not submission-chosen (see baseline.ts)', () => {
    const bad = { ...validManifest, baseline: 'aggro-lowest-hp' };

    expect(() => parseSubmissionManifest('sample-aggro', bad)).toThrow(/stage 1/i);
  });

  it('rejects a manifest whose id is the reserved external-behavior sentinel', () => {
    const bad = { ...validManifest, id: EXTERNAL_BEHAVIOR_ID };

    expect(() => parseSubmissionManifest(EXTERNAL_BEHAVIOR_ID, bad)).toThrow(/stage 1/i);
    expect(() => parseSubmissionManifest(EXTERNAL_BEHAVIOR_ID, bad)).toThrow(/external/i);
  });

  it('rejects a manifest whose entry does not end in .ts', () => {
    const bad = { ...validManifest, entry: 'behavior.js' };

    expect(() => parseSubmissionManifest('sample-aggro', bad)).toThrow(/stage 1/i);
    expect(() => parseSubmissionManifest('sample-aggro', bad)).toThrow(/\.ts/i);
  });
});
