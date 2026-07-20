import path from 'node:path';
import { loadSubmission } from './load.js';
import type { SubmissionManifest } from './manifest.js';
import { checkRunTwiceIdempotence } from './purity.js';
import { runStage3 } from './stage3.js';
import type { Stage3Result } from './stage3.js';

export type ValidateStage = 1 | 2 | 3;

export type ValidateReport =
  | {
      readonly ok: true;
      readonly submissionId: string;
      readonly manifest: SubmissionManifest;
      readonly stage3: Stage3Result;
    }
  | {
      readonly ok: false;
      readonly submissionId: string;
      readonly stage: ValidateStage;
      readonly reason: string;
    };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Every stage-tagged error thrown by load.ts, purity.ts, and stage3.ts
// begins its message with "Stage N" by convention (see each module's own
// doc comments: "Stage 1 (manifest): ...", "Stage 2 (static scan) rejected
// ...", "Stage 3 (gauntlet) rejected ..."). Reading that leading digit back
// out lets this orchestrator attribute a failure to its stage without
// re-deriving the stage boundary loadSubmission itself straddles (stage 1's
// manifest/entry parse and stage 2's static scan both happen inside a
// single loadSubmission call -- see load.ts). Falls back to `fallback` if a
// caller-supplied error (or a non-Error throw) does not follow the
// convention, so this never crashes attributing a failure.
function stageOf(error: unknown, fallback: ValidateStage): ValidateStage {
  const match = /^Stage ([123])\b/.exec(messageOf(error));
  return match ? (Number(match[1]) as ValidateStage) : fallback;
}

/**
 * Runs a submission directory through the full foundry gate: stage 1
 * (manifest parse + entry load, itself gated by stage 2's static purity
 * scan -- see load.ts), stage 2's runtime (same-process run-twice)
 * idempotence check (purity.ts), and stage 3's seed-based gauntlet against
 * the submission's shape baseline (gauntlet.ts/baseline.ts/stage3.ts).
 * Short-circuits on the first failing stage. Unlike the lower-level
 * stage functions, this NEVER throws: it always resolves to a
 * ValidateReport, so a caller (cli.ts) can turn a failure into a clean
 * exit code instead of an uncaught rejection.
 */
export async function validateSubmission(dir: string): Promise<ValidateReport> {
  const submissionId = path.basename(dir);

  let loaded: Awaited<ReturnType<typeof loadSubmission>>;
  try {
    loaded = await loadSubmission(dir);
  } catch (error) {
    return { ok: false, submissionId, stage: stageOf(error, 1), reason: messageOf(error) };
  }

  try {
    checkRunTwiceIdempotence(loaded.manifest, loaded.behavior);
  } catch (error) {
    return { ok: false, submissionId, stage: stageOf(error, 2), reason: messageOf(error) };
  }

  try {
    const stage3 = runStage3(loaded.manifest, loaded.behavior);
    return { ok: true, submissionId, manifest: loaded.manifest, stage3 };
  } catch (error) {
    return { ok: false, submissionId, stage: stageOf(error, 3), reason: messageOf(error) };
  }
}
