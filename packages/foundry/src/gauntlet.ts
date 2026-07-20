import { RULESET_VERSION, runMatchWithBehaviors } from '@warwright/core';
import type { Behavior, Replay, Warband, Winner } from '@warwright/core';
import { baselineWarbandFor } from './baseline.js';
import type { SubmissionManifest } from './manifest.js';

// Stage 3's fixed, committed seed set (see the #67b SUB_PLAN's "Stage 3"
// section): seeds 1..25. Small enough to run in CI (the core resolves
// hundreds of matches per second; no ML deps needed here -- see the
// SUB_PLAN's "operating facts") while large enough to stabilize a win-rate
// estimate to within a few percentage points. Committed as a literal
// constant (not derived at runtime) so the gauntlet's seed set can never
// silently drift between runs or machines.
export const GAUNTLET_SEED_COUNT = 25;
export const GAUNTLET_SEEDS: readonly number[] = Array.from(
  { length: GAUNTLET_SEED_COUNT },
  (_unused, index) => index + 1,
);

export type GauntletMatch = {
  readonly seed: number;
  readonly winner: Winner;
  readonly hash: number;
};

export type GauntletResult = {
  readonly submissionId: string;
  readonly wins: number;
  readonly total: number;
  readonly winRate: number;
  readonly matches: readonly GauntletMatch[];
};

// Team A: the submission's own manifest build, with the submission's own
// Behavior id (load.ts already verified the loaded Behavior's `id` equals
// `manifest.id`, and stage 1 already verified `manifest.build`'s
// roleId/skillIds resolve against core's real content -- see manifest.ts).
function submissionWarband(manifest: SubmissionManifest): Warband {
  return {
    name: `foundry-submission-${manifest.id}`,
    units: [
      {
        roleId: manifest.build.roleId,
        skillIds: manifest.build.skillIds,
        behaviorId: manifest.id,
        position: manifest.build.position,
      },
    ],
  };
}

/**
 * Stage 3's seed-based ladder gauntlet: runs the submission's Behavior
 * (team A, `submissionWarband`) against its shape's fixed baseline roster
 * (team B, `baselineWarbandFor` -- see baseline.ts) over every seed in
 * `seeds` (default `GAUNTLET_SEEDS`), via the core's `runMatchWithBehaviors`
 * seam. The core builds every UnitView/WorldView/observation and draws all
 * RNG in ascending-id order (see CLAUDE.md's determinism contract); this
 * function never re-implements or peeks at combat resolution.
 *
 * Metric: `winRate = wins / total`, where a `'draw'` (the MATCH_TICK_CAP
 * outcome -- see constants.ts) counts as a non-win, matching the SUB_PLAN's
 * "a draw counts as a non-win" rule (an idle Behavior that stalls to the
 * tick cap scores ~0). Single-sided v1: the submission is always team A
 * (mirrored-sides evaluation is a documented future extension, since a
 * policy Behavior can be position-specific).
 *
 * If `decide()` throws during any seed's match -- most commonly a policy
 * Behavior's own roster-shape/obsDim check (see policy-smoke-v1.ts) when
 * the submission's declared `shape` does not match the roster it actually
 * gets -- this throws a Stage-3-tagged error wrapping the underlying cause,
 * so the failure surfaces as a clearly-attributed stage-3 rejection instead
 * of an opaque core-internal exception (per the SUB_PLAN's "surface a clear
 * stage-3 message on a shape mismatch").
 */
export function runGauntlet(
  manifest: SubmissionManifest,
  behavior: Behavior,
  seeds: readonly number[] = GAUNTLET_SEEDS,
): GauntletResult {
  const buildA = submissionWarband(manifest);
  const buildB = baselineWarbandFor(manifest);

  const matches: GauntletMatch[] = seeds.map((seed) => {
    const replay: Replay = { version: RULESET_VERSION, seed, buildA, buildB };
    try {
      const result = runMatchWithBehaviors(replay, [behavior]);
      return { seed, winner: result.winner, hash: result.hash };
    } catch (error) {
      throw new Error(
        `Stage 3 (gauntlet) rejected submission "${manifest.id}": decide() threw during seed ` +
          `${seed} (${String(error instanceof Error ? error.message : error)})`,
        { cause: error },
      );
    }
  });

  const wins = matches.filter((match) => match.winner === 'A').length;

  return {
    submissionId: manifest.id,
    wins,
    total: seeds.length,
    winRate: wins / seeds.length,
    matches,
  };
}
