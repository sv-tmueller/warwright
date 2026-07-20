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

  it('runs the gauntlet over a caller-supplied seed set instead of the full default when one is given', async () => {
    const { manifest: loadedManifest, behavior } = await loadSubmission(
      path.join(SUBMISSIONS_DIR, 'sample-aggro'),
    );

    const result = runStage3(loadedManifest, behavior, [1, 2, 3]);

    expect(result.total).toBe(3);
    expect(result.status).toBe('pass');
  });

  it('clears the bar for submissions/sample-aggro (rule-based, general shape)', async () => {
    const { manifest: loadedManifest, behavior } = await loadSubmission(
      path.join(SUBMISSIONS_DIR, 'sample-aggro'),
    );

    const result = runStage3(loadedManifest, behavior);

    expect(result.status).toBe('pass');
    expect(result.winRate).toBeGreaterThanOrEqual(BASELINE_WIN_RATE_THRESHOLD);
  });

  // Small, explicit seed set: this test is exercising runStage3's own
  // pass/threshold wiring for the exported-policy path, not re-proving the
  // full 25-seed bar (validate.test.ts's sample-policy case is the ONE
  // test that runs sample-policy through the real, full GAUNTLET_SEEDS --
  // see its comment). Each seed still runs policy-smoke-v1's full MLP
  // inference every tick, so keeping this small avoids paying that cost
  // redundantly across the suite.
  it('clears the bar for submissions/sample-policy (exported policy, 1v1 shape)', async () => {
    const { manifest: loadedManifest, behavior } = await loadSubmission(
      path.join(SUBMISSIONS_DIR, 'sample-policy'),
    );

    const result = runStage3(loadedManifest, behavior, [1, 2, 3, 4, 5]);

    expect(result.status).toBe('pass');
    expect(result.total).toBe(5);
    expect(result.winRate).toBeGreaterThanOrEqual(BASELINE_WIN_RATE_THRESHOLD);
  });

  it('rejects fixtures/weak-idle at stage 3: win rate ~0, below the bar', async () => {
    const { manifest: loadedManifest, behavior } = await loadSubmission(
      path.join(FIXTURES_DIR, 'weak-idle'),
    );

    expect(() => runStage3(loadedManifest, behavior)).toThrow(/stage 3/i);
  });
});
