import { z } from 'zod';
import { BehaviorIdSchema, UnitBuildSchema, behaviorIds } from '@warwright/core';

// The submission's own id (a new Behavior id, not yet registered anywhere)
// is going to be resolved as a `behaviorId` inside the real core loop (see
// the #135 core seam, createSeedRegistryWith). It must never collide with a
// seed Behavior's id -- that duplicate-id check already throws loud one
// layer down (ContentRegistry.registerBehavior), but rejecting it here, at
// manifest-parse time, gives a much earlier and clearer stage-1 error.
const SEED_BEHAVIOR_IDS: readonly string[] = behaviorIds;

export const SHAPE_KINDS = ['general', '1v1'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

// The build a submission's unit spawns with. Reuses core's UnitBuildSchema
// for roleId/skillIds/position, but omits `behaviorId`: the submission IS
// the Behavior (its `behaviorId` is always its own manifest `id`), so
// asking for it here would be redundant and could be made to lie.
export const SubmissionBuildSchema = UnitBuildSchema.omit({ behaviorId: true });

export const SubmissionManifestSchema = z.strictObject({
  id: BehaviorIdSchema,
  author: z.string().min(1),
  entry: z.string().min(1),
  build: SubmissionBuildSchema,
  baseline: BehaviorIdSchema,
  shape: z.enum(SHAPE_KINDS),
});

export type SubmissionManifest = z.infer<typeof SubmissionManifestSchema>;

/**
 * Stage 1 of the foundry gate: parse+validate a submission's manifest.json
 * against the schema, then check the two structural rules a Zod schema
 * alone cannot express: the manifest's `id` must equal the submission's
 * directory name (`dirName`), and it must not collide with an
 * already-registered seed Behavior id. Throws loud (with the stage
 * identified in the message) on any failure; never touches the filesystem
 * or imports the submission's entry module (that is load.ts's job, and only
 * after stage 2's static scan passes).
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

  if (SEED_BEHAVIOR_IDS.includes(manifest.id)) {
    throw new Error(
      `Stage 1 (manifest): id "${manifest.id}" collides with an already-registered seed Behavior id (${SEED_BEHAVIOR_IDS.join(', ')})`,
    );
  }

  return manifest;
}
