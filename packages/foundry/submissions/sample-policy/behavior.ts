// An exported-policy sample submission: reuses the merged #66a/#66b
// policy-smoke-v1 checkpoint's `decide` function (weights + pure-TS
// float64 inference, both already registered inside the core) under a
// NEW Behavior id, since a submission's own id can never collide with an
// already-registered seed Behavior id (see manifest.ts's stage-1 check).
// `policySmokeV1` is exported from '@warwright/core' by name specifically
// so an exported-policy submission like this one can do this -- see the
// doc comment on that export in packages/core/src/index.ts.
//
// `shape: '1v1'` in manifest.json declares this submission needs EXACTLY
// the roster policy-smoke-v1 was trained on (0 allies, 1 enemy): the
// foundry gate's stage-3 gauntlet evaluates a '1v1'-shaped submission
// against builds/policy-1v1-b.json's warband specifically because of this
// (see packages/foundry/src/baseline.ts).
import type { Behavior } from '@warwright/core';
import { policySmokeV1 } from '@warwright/core';

export const behavior: Behavior = {
  id: 'sample-policy',
  decide: policySmokeV1.decide,
};
