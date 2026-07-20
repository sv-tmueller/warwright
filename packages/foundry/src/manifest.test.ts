import { describe, expect, it } from 'vitest';
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
  baseline: 'aggro-lowest-hp',
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

    expect(() => parseSubmissionManifest('sample-aggro', bad)).toThrow();
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
});
