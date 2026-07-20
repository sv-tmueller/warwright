import type { Behavior } from '@warwright/core';
import type { GauntletResult } from './gauntlet.js';
import { GAUNTLET_SEEDS, runGauntlet } from './gauntlet.js';
import type { SubmissionManifest } from './manifest.js';

// Calibrated from MEASURED win rates (see the #67b PR report / this file's
// own git history for the exact run this constant was set from), running
// the full 25-seed gauntlet (see gauntlet.ts's GAUNTLET_SEEDS) for every
// committed sample and fixture:
//   sample-aggro  (general, 2x mender/aggro-lowest-hp baseline): 25/25 = 1.0
//   sample-policy (1v1, policy-1v1-b/warden/aggro-lowest-hp):    25/25 = 1.0
//   weak-idle     (general, 2x mender/aggro-lowest-hp baseline):  0/25 = 0.0
// Both valid samples clear a perfect win rate; the invalid weak-idle
// fixture (never attacks, stalls every match to the tick cap -- a 'draw',
// which counts as a non-win) scores exactly 0. The gap between 0.0 and 1.0
// is total, so 0.6 (the SUB_PLAN's own starting hypothesis) is kept as the
// threshold: comfortably below both valid samples' measured rate and
// comfortably above the invalid fixture's, with wide margin on both sides.
//
// IMPORTANT: both valid samples hit exactly 1.0 only because the baseline
// rosters are DELIBERATELY WEAK -- the 'general' roster is two skill-less
// menders (see baseline.ts's GATE_GENERAL_BASELINE_BEHAVIOR_ID roster) and
// the '1v1' roster is a single lone warden (builds/policy-1v1-b.json). With
// a roster this weak, 0.6 is really just separating "the submission fights
// back at all" from "the submission idles/stalls" -- it is NOT yet a
// meaningful skill bar. If the baseline roster is ever strengthened (more
// units, skills, a smarter Behavior), this threshold MUST be re-measured
// from scratch by the same procedure (run the full gauntlet for every
// committed sample/fixture and record the numbers here) -- do not assume
// 0.6 still sits in the gap.
export const BASELINE_WIN_RATE_THRESHOLD = 0.6;

export type Stage3Result = {
  readonly stage: 3;
  readonly status: 'pass';
  readonly submissionId: string;
  readonly wins: number;
  readonly total: number;
  readonly winRate: number;
  readonly threshold: number;
};

/**
 * Stage 3 of the foundry gate: the real seed-based ladder gauntlet (see
 * gauntlet.ts/baseline.ts). Runs the submission's Behavior through the
 * fixed seed set against its shape's baseline roster and requires
 * `winRate >= BASELINE_WIN_RATE_THRESHOLD`. Throws a Stage-3-tagged error
 * (either the gauntlet's own -- e.g. a roster-shape mismatch, see
 * gauntlet.ts -- or a below-the-bar rejection) on failure; returns a
 * Stage3Result only on a clear pass.
 *
 * `seeds` defaults to the full, committed `GAUNTLET_SEEDS` (the real gate:
 * every production caller -- validate.ts, and therefore cli.ts -- calls
 * this with no third argument, so the production bar is always evaluated
 * over all 25 seeds). The parameter exists so foundry's OWN test suite can
 * exercise this function's plumbing (stage-attribution, pass/fail wiring)
 * against a small seed set without re-running an expensive policy
 * Behavior's inference 25 times per test -- see stage3.test.ts. Never
 * reach for this from production code.
 */
export function runStage3(
  manifest: SubmissionManifest,
  behavior: Behavior,
  seeds: readonly number[] = GAUNTLET_SEEDS,
): Stage3Result {
  if (behavior.id !== manifest.id) {
    // Defensive: load.ts already enforces this, but stage3 never trusts a
    // caller that skipped stages 1-2.
    throw new Error(
      `Stage 3 (gauntlet): Behavior id "${behavior.id}" does not match manifest id "${manifest.id}"`,
    );
  }

  const gauntlet: GauntletResult = runGauntlet(manifest, behavior, seeds);

  if (gauntlet.winRate < BASELINE_WIN_RATE_THRESHOLD) {
    throw new Error(
      `Stage 3 (gauntlet) rejected submission "${manifest.id}": win rate ${gauntlet.winRate} ` +
        `(${gauntlet.wins}/${gauntlet.total}) is below the baseline bar ` +
        `${BASELINE_WIN_RATE_THRESHOLD}`,
    );
  }

  return {
    stage: 3,
    status: 'pass',
    submissionId: manifest.id,
    wins: gauntlet.wins,
    total: gauntlet.total,
    winRate: gauntlet.winRate,
    threshold: BASELINE_WIN_RATE_THRESHOLD,
  };
}
