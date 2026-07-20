import { loadSubmission } from './load.js';
import type { SubmissionManifest } from './manifest.js';
import { checkRunTwiceIdempotence } from './purity.js';
import { runStage3Stub } from './stage3.js';
import type { Stage3StubResult } from './stage3.js';

export type GateResult = {
  readonly manifest: SubmissionManifest;
  readonly stage3: Stage3StubResult;
};

/**
 * Runs a submission directory through the full foundry gate pipeline built
 * in this slice: stage 1 (manifest parse + entry load, itself gated by
 * stage 2's static scan -- see load.ts), stage 2's runtime (same-process
 * run-twice) idempotence check, and finally the stubbed stage 3 hook (the
 * real gauntlet is #67b). Rejects with the failing stage identified in the
 * error message; a submission never reaches a later stage's checks once an
 * earlier one has failed.
 */
export async function runGate(dir: string): Promise<GateResult> {
  const { manifest, behavior } = await loadSubmission(dir);
  checkRunTwiceIdempotence(manifest, behavior);
  const stage3 = runStage3Stub(manifest, behavior);
  return { manifest, stage3 };
}
