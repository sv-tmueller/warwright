import { z } from 'zod';
import {
  BehaviorIdSchema,
  EXTERNAL_BEHAVIOR_ID,
  UnitBuildSchema,
  behaviorIds,
  roles,
  skills,
} from '@warwright/core';

// The submission's own id (a new Behavior id, not yet registered anywhere)
// is going to be resolved as a `behaviorId` inside the real core loop (see
// the #135 core seam, createSeedRegistryWith). It must never collide with a
// seed Behavior's id -- that duplicate-id check already throws loud one
// layer down (ContentRegistry.registerBehavior), but rejecting it here, at
// manifest-parse time, gives a much earlier and clearer stage-1 error.
const SEED_BEHAVIOR_IDS: readonly string[] = behaviorIds;

// Content-id lookups, used to validate a submission's build against core's
// actual public content instead of deferring to a deep, confusing failure
// inside the core loop (see Fix 1, review of PR #136).
const KNOWN_ROLE_IDS: ReadonlySet<string> = new Set(roles.map((role) => role.id));
const KNOWN_SKILL_IDS: ReadonlySet<string> = new Set(skills.map((skill) => skill.id));

export const SHAPE_KINDS = ['general', '1v1'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

// The build a submission's unit spawns with. Reuses core's UnitBuildSchema
// for roleId/skillIds/position, but omits `behaviorId`: the submission IS
// the Behavior (its `behaviorId` is always its own manifest `id`), so
// asking for it here would be redundant and could be made to lie.
export const SubmissionBuildSchema = UnitBuildSchema.omit({ behaviorId: true });

// Deliberately has NO `baseline` field: stage 3's gauntlet opponent Behavior
// is GATE-pinned (see baseline.ts's GATE_GENERAL_BASELINE_BEHAVIOR_ID and
// its hard-coded builds/policy-1v1-b.json load), never submission-chosen.
// An earlier revision let a submission's own manifest pick its gauntlet
// opponent's Behavior id via this field; besides letting a submitter choose
// an opponent it knows it can beat, a legal-looking value naming an
// exported-policy Behavior made the GATE-side baseline unit itself throw an
// obsDim-mismatch error, which the gauntlet then misattributed to the
// submission's own decide() (Fix 1, review of PR #137). `strictObject`
// rejects any manifest.json that still declares `baseline` outright, so a
// stale or copy-pasted submission fails loud at stage 1 instead of silently
// being ignored.
export const SubmissionManifestSchema = z.strictObject({
  id: BehaviorIdSchema,
  author: z.string().min(1),
  entry: z.string().min(1),
  build: SubmissionBuildSchema,
  shape: z.enum(SHAPE_KINDS),
});

export type SubmissionManifest = z.infer<typeof SubmissionManifestSchema>;

/**
 * Stage 1 of the foundry gate: parse+validate a submission's manifest.json
 * against the schema, then check the structural rules a Zod schema alone
 * cannot express: the manifest's `id` must equal the submission's directory
 * name (`dirName`); it must not collide with an already-registered seed
 * Behavior id, nor with the reserved `EXTERNAL_BEHAVIOR_ID` sentinel; its
 * `entry` must be a `.ts` file (see purity.ts's static scan, which only
 * walks `.ts` files -- anything else would be imported and executed
 * unscanned); and its `build.roleId` and `build.skillIds` must resolve
 * against core's actual public content (roles/skills), so an unknown id
 * fails loud here instead of deep inside the core loop.
 * Throws loud (with the stage identified in the message) on any failure;
 * never touches the filesystem or imports the submission's entry module
 * (that is load.ts's job, and only after stage 2's static scan passes).
 */
export function parseSubmissionManifest(dirName: string, data: unknown): SubmissionManifest {
  const result = SubmissionManifestSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Stage 1 (manifest): ${z.prettifyError(result.error)}`);
  }

  const manifest = result.data;

  if (manifest.id !== dirName) {
    throw new Error(
      `Stage 1 (manifest): id "${manifest.id}" must equal the submission directory name "${dirName}"`,
    );
  }

  if (manifest.id === EXTERNAL_BEHAVIOR_ID) {
    throw new Error(
      `Stage 1 (manifest): id "${manifest.id}" is the reserved external-behavior sentinel (EXTERNAL_BEHAVIOR_ID) and cannot be used as a submission id`,
    );
  }

  if (SEED_BEHAVIOR_IDS.includes(manifest.id)) {
    throw new Error(
      `Stage 1 (manifest): id "${manifest.id}" collides with an already-registered seed Behavior id (${SEED_BEHAVIOR_IDS.join(', ')})`,
    );
  }

  if (!manifest.entry.endsWith('.ts')) {
    throw new Error(
      `Stage 1 (manifest): entry "${manifest.entry}" must end in .ts (stage 2's static scan only walks .ts files)`,
    );
  }

  if (!KNOWN_ROLE_IDS.has(manifest.build.roleId)) {
    throw new Error(
      `Stage 1 (manifest): build.roleId "${manifest.build.roleId}" is not a known core role`,
    );
  }

  for (const skillId of manifest.build.skillIds) {
    if (!KNOWN_SKILL_IDS.has(skillId)) {
      throw new Error(
        `Stage 1 (manifest): build.skillIds contains unknown skill "${skillId}"`,
      );
    }
  }

  return manifest;
}
