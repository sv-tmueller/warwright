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

// The 'general' baseline roster's opponent Behavior id, fixed GATE-side
// (see Fix 1, review of PR #137). A submission's manifest has NO `baseline`
// field (see manifest.ts): the gauntlet's opponent brain must be a fixed
// part of the gate, not something the submission itself can pick. Letting a
// submission choose would let it dodge the bar entirely by naming an
// opponent it knows it beats -- and, worse, a legal-looking value naming an
// exported-policy Behavior trained on a different roster shape made the
// baseline UNIT itself throw an obsDim-mismatch error (its expected 0-ally/
// 1-enemy roster shape didn't match the 'general' roster's 0-ally/2-enemy
// shape), which the gauntlet then misattributed to the submission's own
// decide(). `aggro-lowest-hp` is a simple, always-legal seed Behavior
// against any roster shape.
export const GATE_GENERAL_BASELINE_BEHAVIOR_ID = 'aggro-lowest-hp';

/**
 * Stage 3's baseline roster (team B) for a submission's declared `shape`
 * (see the #67b SUB_PLAN's "Stage 3" section). Both rosters below are fixed
 * GATE-side, never submission-chosen (see Fix 1, review of PR #137):
 *
 * - `'1v1'`: EXACTLY `builds/policy-1v1-b.json`'s warband -- a single
 *   warden running `aggro-lowest-hp` at (15, 0), loaded once at module
 *   load from the committed build file. This is exactly the roster the
 *   original #66 exported-policy demo was trained to beat (see
 *   gym/warwright_gym/training/smoke_run.py's `smoke_build_b`), so any
 *   '1v1'-shaped policy submission gets evaluated against the matchup it
 *   actually understands (0 allies, 1 enemy).
 * - `'general'`: a two-unit roster of generic menders (no skills) both
 *   running `GATE_GENERAL_BASELINE_BEHAVIOR_ID` -- a step up from stage 2's
 *   single-baseline-unit `representativeReplay` (see purity.ts, which uses
 *   the same gate-pinned id) convention, giving a submitter a genuine
 *   multi-opponent bar to clear. Deliberately a DIFFERENT roster shape (0
 *   allies, 2 enemies) than '1v1' (0 allies, 1 enemy): a policy Behavior
 *   mistakenly declared `shape: 'general'` faces an observation of the
 *   wrong length and throws its own roster-shape error -- surfaced as a
 *   clear stage-3 message by gauntlet.ts, per the SUB_PLAN's "surface a
 *   clear stage-3 message on a shape mismatch."
 */
export function baselineWarbandFor(manifest: SubmissionManifest): Warband {
  if (manifest.shape === '1v1') {
    return POLICY_1V1_BASELINE;
  }

  return {
    name: `foundry-baseline-general-${GATE_GENERAL_BASELINE_BEHAVIOR_ID}`,
    units: [
      {
        roleId: 'mender',
        skillIds: [],
        behaviorId: GATE_GENERAL_BASELINE_BEHAVIOR_ID,
        position: { x: 500, y: 470 },
        augmentIds: [],
      },
      {
        roleId: 'mender',
        skillIds: [],
        behaviorId: GATE_GENERAL_BASELINE_BEHAVIOR_ID,
        position: { x: 500, y: 530 },
        augmentIds: [],
      },
    ],
  };
}
