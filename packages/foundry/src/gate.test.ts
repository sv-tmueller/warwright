import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runGate } from './gate.js';

const SUBMISSIONS_DIR = fileURLToPath(new URL('../submissions/', import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

describe('runGate', () => {
  it('runs a valid submission through stage 1 and stage 2 to the stage-3 stub', async () => {
    const result = await runGate(path.join(SUBMISSIONS_DIR, 'sample-aggro'));

    expect(result.manifest.id).toBe('sample-aggro');
    expect(result.stage3).toEqual({
      stage: 3,
      status: 'not-implemented',
      submissionId: 'sample-aggro',
    });
  });

  it('rejects fixtures/bad-manifest at stage 1', async () => {
    await expect(runGate(path.join(FIXTURES_DIR, 'bad-manifest'))).rejects.toThrow(/stage 1/i);
  });

  it('rejects fixtures/bad-import at stage 2 (static)', async () => {
    await expect(runGate(path.join(FIXTURES_DIR, 'bad-import'))).rejects.toThrow(
      /stage 2 \(static/i,
    );
  });

  it('rejects fixtures/bad-side-effect at stage 2 (runtime idempotence)', async () => {
    await expect(runGate(path.join(FIXTURES_DIR, 'bad-side-effect'))).rejects.toThrow(
      /stage 2 \(runtime/i,
    );
  });
});
