import type { Augment } from '../schemas.js';

// Instances land in Slice D/#150. This slice (#147, Slice A) delivers only
// the augment primitive (schema, registry, UnitBuildSchema.augmentIds,
// init-time application) -- no augment content yet.
export const augments = [] satisfies readonly Augment[];
