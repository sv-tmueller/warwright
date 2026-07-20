import type { Behavior } from '@warwright/core';
import type { SubmissionManifest } from './manifest.js';

// Stub only: a submission that clears stage 1 (manifest + entry) and stage 2
// (static purity scan + same-process run-twice idempotence) lands here. The
// real gauntlet -- a threshold evaluation against `manifest.baseline` across
// many seeds -- is #67b; this hook exists only so the pipeline has
// somewhere for a fully-gated submission to reach in this slice.
export type Stage3StubResult = {
  readonly stage: 3;
  readonly status: 'not-implemented';
  readonly submissionId: string;
};

export function runStage3Stub(manifest: SubmissionManifest, behavior: Behavior): Stage3StubResult {
  if (behavior.id !== manifest.id) {
    // Defensive: load.ts already enforces this, but stage3 never trusts a
    // caller that skipped stages 1-2.
    throw new Error(
      `Stage 3 (stub): Behavior id "${behavior.id}" does not match manifest id "${manifest.id}"`,
    );
  }

  return { stage: 3, status: 'not-implemented', submissionId: manifest.id };
}
