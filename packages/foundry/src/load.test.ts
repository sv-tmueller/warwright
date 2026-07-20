import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSubmission } from './load.js';

const SUBMISSIONS_DIR = fileURLToPath(new URL('../submissions/', import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

const tempDirs: string[] = [];

function makeTempSubmissionDir(dirName: string, files: Record<string, string>): string {
  const parent = mkdtempSync(path.join(tmpdir(), 'foundry-load-'));
  tempDirs.push(parent);
  const dir = path.join(parent, dirName);
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), contents, 'utf8');
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadSubmission', () => {
  it('loads a valid submission end to end (manifest + dynamic-imported Behavior)', async () => {
    const loaded = await loadSubmission(path.join(SUBMISSIONS_DIR, 'sample-aggro'));

    expect(loaded.manifest.id).toBe('sample-aggro');
    expect(loaded.behavior.id).toBe('sample-aggro');
    expect(typeof loaded.behavior.decide).toBe('function');
  });

  it('rejects a malformed manifest at stage 1, without ever importing an entry', async () => {
    await expect(loadSubmission(path.join(FIXTURES_DIR, 'bad-manifest'))).rejects.toThrow(
      /stage 1/i,
    );
  });

  it('rejects when the manifest id does not match the directory name (stage 1)', async () => {
    const dir = makeTempSubmissionDir('mismatched-dir', {
      'manifest.json': JSON.stringify({
        id: 'declared-id',
        author: 'foundry-fixtures',
        entry: 'behavior.ts',
        build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
        shape: 'general',
      }),
      'behavior.ts': `
        import type { Action, Behavior, UnitView, WorldView } from '@warwright/core';
        function decide(self: UnitView, world: WorldView): Action {
          void self; void world;
          return { kind: 'idle' };
        }
        export const behavior: Behavior = { id: 'declared-id', decide };
      `,
    });

    await expect(loadSubmission(dir)).rejects.toThrow(/stage 1/i);
  });

  it('rejects a submission whose entry does not export a matching Behavior (non-Behavior export)', async () => {
    const dir = makeTempSubmissionDir('no-behavior-export', {
      'manifest.json': JSON.stringify({
        id: 'no-behavior-export',
        author: 'foundry-fixtures',
        entry: 'behavior.ts',
        build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
        shape: 'general',
      }),
      'behavior.ts': `export const notABehavior = 'just a string';`,
    });

    await expect(loadSubmission(dir)).rejects.toThrow(/stage 1 \(entry/i);
    await expect(loadSubmission(dir)).rejects.toThrow(/does not export a Behavior/i);
  });

  it('rejects a submission at stage 2 (static) before ever importing its entry', async () => {
    await expect(loadSubmission(path.join(FIXTURES_DIR, 'bad-import'))).rejects.toThrow(
      /stage 2 \(static/i,
    );
  });

  it('rejects a submission whose entry is not a .ts file (stage 1)', async () => {
    const dir = makeTempSubmissionDir('js-entry', {
      'manifest.json': JSON.stringify({
        id: 'js-entry',
        author: 'foundry-fixtures',
        entry: 'behavior.js',
        build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
        shape: 'general',
      }),
      'behavior.js': `module.exports = { id: 'js-entry', decide: () => ({ kind: 'idle' }) };`,
    });

    await expect(loadSubmission(dir)).rejects.toThrow(/stage 1/i);
    await expect(loadSubmission(dir)).rejects.toThrow(/\.ts/i);
  });
});
