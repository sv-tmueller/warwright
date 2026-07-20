import { describe, expect, it } from 'vitest';
import type { Behavior } from '@warwright/core';
import { parseSubmissionManifest } from './manifest.js';
import { runStage3Stub } from './stage3.js';

const manifest = parseSubmissionManifest('sample-aggro', {
  id: 'sample-aggro',
  author: 'foundry-fixtures',
  entry: 'behavior.ts',
  build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
  baseline: 'aggro-lowest-hp',
  shape: 'general',
});

describe('runStage3Stub', () => {
  it('reports a not-implemented stub result for a fully-gated submission', () => {
    const behavior: Behavior = { id: 'sample-aggro', decide: () => ({ kind: 'idle' }) };

    const result = runStage3Stub(manifest, behavior);

    expect(result).toEqual({ stage: 3, status: 'not-implemented', submissionId: 'sample-aggro' });
  });

  it('throws when the Behavior id does not match the manifest id', () => {
    const mismatched: Behavior = { id: 'someone-else', decide: () => ({ kind: 'idle' }) };

    expect(() => runStage3Stub(manifest, mismatched)).toThrow(/stage 3/i);
  });
});
