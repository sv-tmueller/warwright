import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Behavior } from '@warwright/core';
import { loadSubmission } from './load.js';
import { parseSubmissionManifest } from './manifest.js';
import { BASELINE_WIN_RATE_THRESHOLD, runStage3 } from './stage3.js';

const SUBMISSIONS_DIR = fileURLToPath(new URL('../submissions/', import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

const manifest = parseSubmissionManifest('sample-aggro', {
  id: 'sample-aggro',
  author: 'foundry-fixtures',
  entry: 'behavior.ts',
  build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
  shape: 'general',
});

describe('BASELINE_WIN_RATE_THRESHOLD', () => {
  it('is a fraction strictly between 0 and 1', () => {
    expect(BASELINE_WIN_RATE_THRESHOLD).toBeGreaterThan(0);
    expect(BASELINE_WIN_RATE_THRESHOLD).toBeLessThan(1);
  });
});

describe('runStage3', () => {
  it('throws when the Behavior id does not match the manifest id', () => {
    const mismatched: Behavior = { id: 'someone-else', decide: () => ({ kind: 'idle' }) };

    expect(() => runStage3(manifest, mismatched)).toThrow(/stage 3/i);
  });

  it('clears the bar for submissions/sample-aggro (rule-based, general shape)', async () => {
    const { manifest: loadedManifest, behavior } = await loadSubmission(
      path.join(SUBMISSIONS_DIR, 'sample-aggro'),
    );

    const result = runStage3(loadedManifest, behavior);

    expect(result.status).toBe('pass');
    expect(result.winRate).toBeGreaterThanOrEqual(BASELINE_WIN_RATE_THRESHOLD);
  });

  // Longer timeout: 25 seeds of policy-smoke-v1 inference is noticeably
  // slower than the rule-based sample-aggro case, and can cross the
  // default 5000ms under full-monorepo test-suite CPU contention.
  it(
    'clears the bar for submissions/sample-policy (exported policy, 1v1 shape)',
    async () => {
      const { manifest: loadedManifest, behavior } = await loadSubmission(
        path.join(SUBMISSIONS_DIR, 'sample-policy'),
      );

      const result = runStage3(loadedManifest, behavior);

      expect(result.status).toBe('pass');
      expect(result.winRate).toBeGreaterThanOrEqual(BASELINE_WIN_RATE_THRESHOLD);
    },
    20_000,
  );

  it('rejects fixtures/weak-idle at stage 3: win rate ~0, below the bar', async () => {
    const { manifest: loadedManifest, behavior } = await loadSubmission(
      path.join(FIXTURES_DIR, 'weak-idle'),
    );

    expect(() => runStage3(loadedManifest, behavior)).toThrow(/stage 3/i);
  });
});
