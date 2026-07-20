// Zod schema + shape cross-checks for an exported policy's weights JSON
// (the #66a export contract, gym/EXPORT.md's "TS mirror contract"). Fails
// loud at MODULE LOAD on the committed policy-smoke-v1.weights.json, so a
// desynced or corrupted artifact breaks the build immediately rather than
// producing silently-wrong inference at play time.

import { z } from 'zod';
import { OBS_ENCODING_VERSION } from '../../../sim/observation.js';
import policySmokeV1WeightsJson from './policy-smoke-v1.weights.json' with { type: 'json' };

// torch.nn.Linear layout: `weight[out][in]`, `bias[out]`.
const LinearLayerSchema = z.strictObject({
  weight: z.array(z.array(z.number())),
  bias: z.array(z.number()),
});

export const PolicyWeightsSchema = z.strictObject({
  formatVersion: z.number(),
  behaviorId: z.string().min(1),
  obsEncodingVersion: z.number(),
  obsDim: z.int().positive(),
  nvec: z.array(z.int().positive()).min(1),
  hidden: z.tuple([z.int().positive(), z.int().positive()]),
  trunk1: LinearLayerSchema,
  trunk2: LinearLayerSchema,
  actorHead: LinearLayerSchema,
});

export type LinearLayer = z.infer<typeof LinearLayerSchema>;
export type PolicyWeights = z.infer<typeof PolicyWeightsSchema>;

function assertLayerShape(
  name: string,
  layer: LinearLayer,
  expectedOutDim: number,
  expectedInDim: number,
): void {
  if (layer.weight.length !== expectedOutDim) {
    throw new Error(
      `parsePolicyWeights: ${name}.weight has ${layer.weight.length} output rows, expected ${expectedOutDim}`,
    );
  }
  for (const [rowIndex, row] of layer.weight.entries()) {
    if (row.length !== expectedInDim) {
      throw new Error(
        `parsePolicyWeights: ${name}.weight row ${rowIndex} has ${row.length} columns, expected ${expectedInDim}`,
      );
    }
  }
  if (layer.bias.length !== expectedOutDim) {
    throw new Error(
      `parsePolicyWeights: ${name}.bias has length ${layer.bias.length}, expected ${expectedOutDim}`,
    );
  }
}

// Validate the raw JSON shape (Zod), then cross-check every matrix/vector
// dimension against the weights' own declared obsDim/hidden/nvec, then
// assert the encoding-version pin. Every failure throws with the offending
// field's name in the message -- fail loud, never silently truncate/pad.
export function parsePolicyWeights(data: unknown): PolicyWeights {
  const weights = PolicyWeightsSchema.parse(data);
  const [hiddenA, hiddenB] = weights.hidden;
  const actionDim = weights.nvec.reduce((sum, n) => sum + n, 0);

  assertLayerShape('trunk1', weights.trunk1, hiddenA, weights.obsDim);
  assertLayerShape('trunk2', weights.trunk2, hiddenB, hiddenA);
  assertLayerShape('actorHead', weights.actorHead, actionDim, hiddenB);

  if (weights.obsEncodingVersion !== OBS_ENCODING_VERSION) {
    throw new Error(
      `parsePolicyWeights: obsEncodingVersion ${weights.obsEncodingVersion} does not match the ` +
        `running OBS_ENCODING_VERSION ${OBS_ENCODING_VERSION}`,
    );
  }

  return weights;
}

// The committed policy-smoke-v1 artifact, validated once at module load
// (see the module docstring) and shared by inference.ts, policy-smoke-v1.ts,
// and the parity test.
export const policySmokeV1Weights: PolicyWeights = parsePolicyWeights(policySmokeV1WeightsJson);
