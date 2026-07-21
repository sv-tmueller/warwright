import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// packages/foundry/src -> packages/foundry -> packages -> repo root.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI_PATH = path.join(REPO_ROOT, 'packages/foundry/src/cli.ts');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules/.bin/tsx');

type CliRun = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

function runCli(dir: string): CliRun {
  const result = spawnSync(TSX_BIN, [CLI_PATH, 'validate', dir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Both-ways end-to-end proof (see the #67b SUB_PLAN's "Tests" section):
// spawns the REAL `foundry validate` CLI (not just validateSubmission()'s
// in-process report -- this is the actual entry point CI's own foundry
// gate step and a submitter both invoke) against every committed valid
// submission and every committed invalid fixture, and asserts the process
// exit code and the reported failing stage.
//
// Only sample-aggro (rule-based) exercises the CLI's success path here.
// cli.ts is submission-agnostic wiring -- it calls validateSubmission()
// and formats whatever ValidateReport comes back, with no policy-specific
// branch -- so a second real-CLI-process's worth of spawn + full-gauntlet
// cost for an exported-policy submission would add no coverage beyond
// what this already proves for the production stage-3 gate, in-process.
describe('foundry validate CLI (end to end)', () => {
  it('exits 0 for the valid submission sample-aggro', () => {
    const result = runCli('packages/foundry/submissions/sample-aggro');

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^PASS/);
  });

  it.each([
    ['bad-manifest', 1],
    ['bad-import', 2],
    ['bad-side-effect', 2],
    ['weak-idle', 3],
  ] as const)(
    'exits nonzero for the invalid fixture %s, at stage %s',
    (fixtureId, expectedStage) => {
      const result = runCli(`packages/foundry/fixtures/${fixtureId}`);

      expect(result.status).not.toBe(0);
      expect(result.stdout).toMatch(/^FAIL/);
      expect(result.stdout).toContain(`failed at stage ${expectedStage}`);
    },
    20_000,
  );
});
