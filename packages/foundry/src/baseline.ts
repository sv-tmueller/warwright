import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWarband } from '@warwright/core';
import type { Warband } from '@warwright/core';
import type { SubmissionManifest } from './manifest.js';

// The repo-root `builds/` directory, resolved relative to THIS file's own
// on-disk location (packages/foundry/src/baseline.ts -> ../../../builds),
// so this works the same whether foundry is invoked via tsx from the repo
// root (cli.ts) or via vitest from packages/foundry.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BUILDS_DIR = path.join(REPO_ROOT, 'builds');

function loadCommittedWarband(fileName: string): Warband {
  const raw = readFileSync(path.join(BUILDS_DIR, fileName), 'utf8');
  return parseWarband(JSON.parse(raw) as unknown);
}

// Loaded once at module load, not per gauntlet call: builds/policy-1v1-b.json
// never changes at runtime, and the stage-3 gauntlet calls
// baselineWarbandFor once per seed (see gauntlet.ts).
const POLICY_1V1_BASELINE: Warband = loadCommittedWarband('policy-1v1-b.json');

/**
 * Stage 3's baseline roster (team B) for a submission's declared `shape`
 * (see the #67b SUB_PLAN's "Stage 3" section).
 *
 * - `'1v1'`: EXACTLY `builds/policy-1v1-b.json`'s warband -- a single
 *   warden running `aggro-lowest-hp` at (15, 0). This is intentionally
 *   fixed by the shape, not by the submission's own declared `baseline`
 *   id: it is exactly the roster policy-smoke-v1 (the merged #66 export)
 *   was trained to beat (see gym/warwright_gym/training/smoke_run.py's
 *   `smoke_build_b`), so any '1v1'-shaped policy submission gets evaluated
 *   against the matchup it actually understands (0 allies, 1 enemy).
 * - `'general'`: a two-unit roster of generic menders (no skills) both
 *   running the submission's own declared `manifest.baseline` seed
 *   Behavior id -- a step up from stage 2's single-baseline-unit
 *   `representativeReplay` (see purity.ts) convention, giving a submitter
 *   a genuine multi-opponent bar to clear. Deliberately a DIFFERENT roster
 *   shape (0 allies, 2 enemies) than '1v1' (0 allies, 1 enemy): a policy
 *   Behavior mistakenly declared `shape: 'general'` faces an
 *   observation of the wrong length and throws its own roster-shape error
 *   (see policy-smoke-v1.ts) -- surfaced as a clear stage-3 message by
 *   gauntlet.ts, per the SUB_PLAN's "surface a clear stage-3 message on a
 *   shape mismatch."
 */
export function baselineWarbandFor(manifest: SubmissionManifest): Warband {
  if (manifest.shape === '1v1') {
    return POLICY_1V1_BASELINE;
  }

  return {
    name: `foundry-baseline-general-${manifest.baseline}`,
    units: [
      {
        roleId: 'mender',
        skillIds: [],
        behaviorId: manifest.baseline,
        position: { x: 500, y: 470 },
      },
      {
        roleId: 'mender',
        skillIds: [],
        behaviorId: manifest.baseline,
        position: { x: 500, y: 530 },
      },
    ],
  };
}
