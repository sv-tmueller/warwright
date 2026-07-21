import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASELINE_WIN_RATE_THRESHOLD } from './stage3.js';
import { validateSubmission } from './validate.js';

const SUBMISSIONS_DIR = fileURLToPath(new URL('../submissions/', import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

describe('validateSubmission', () => {
  it('runs a valid rule-based submission (sample-aggro) through all 3 stages to a pass', async () => {
    const report = await validateSubmission(path.join(SUBMISSIONS_DIR, 'sample-aggro'));

    expect(report.ok).toBe(true);
    if (!report.ok) throw new Error('expected ok');
    expect(report.manifest.id).toBe('sample-aggro');
    expect(report.stage3.status).toBe('pass');
    expect(report.stage3.winRate).toBeGreaterThanOrEqual(BASELINE_WIN_RATE_THRESHOLD);
  });

  it('rejects fixtures/bad-manifest at stage 1', async () => {
    const report = await validateSubmission(path.join(FIXTURES_DIR, 'bad-manifest'));

    expect(report.ok).toBe(false);
    if (report.ok) throw new Error('expected a failure');
    expect(report.stage).toBe(1);
    expect(report.reason).toMatch(/stage 1/i);
  });

  it('rejects fixtures/bad-import at stage 2', async () => {
    const report = await validateSubmission(path.join(FIXTURES_DIR, 'bad-import'));

    expect(report.ok).toBe(false);
    if (report.ok) throw new Error('expected a failure');
    expect(report.stage).toBe(2);
    expect(report.reason).toMatch(/stage 2 \(static/i);
  });

  it('rejects fixtures/bad-side-effect at stage 2', async () => {
    const report = await validateSubmission(path.join(FIXTURES_DIR, 'bad-side-effect'));

    expect(report.ok).toBe(false);
    if (report.ok) throw new Error('expected a failure');
    expect(report.stage).toBe(2);
    expect(report.reason).toMatch(/stage 2 \(runtime/i);
  });

  it('rejects fixtures/weak-idle at stage 3', async () => {
    const report = await validateSubmission(path.join(FIXTURES_DIR, 'weak-idle'));

    expect(report.ok).toBe(false);
    if (report.ok) throw new Error('expected a failure');
    expect(report.stage).toBe(3);
    expect(report.reason).toMatch(/stage 3/i);
  });

  it('never throws -- always resolves to a report', async () => {
    await expect(
      validateSubmission(path.join(FIXTURES_DIR, 'bad-manifest')),
    ).resolves.toBeDefined();
  });
});
