// The TS forward pipeline every exported policy's inference must run, per
// gym/EXPORT.md's "TS mirror contract" and gym/warwright_gym/training/
// policy.py's ActorCriticPolicy._trunk/actor_logits (the op-order source of
// truth):
//
//   1. featurize the raw int observation (featurize.ts)
//   2. trunk1: Linear, weight layout [out][in] (torch convention), y = W*x+b
//   3. tanh elementwise (tanh.ts's detTanh, never Math.tanh)
//   4. trunk2: Linear, same layout
//   5. tanh elementwise
//   6. actorHead: Linear, same layout -> one flat logits vector
//   7. split the flat logits vector into one segment per `nvec` entry, in
//      nvec order
//   8. per-component argmax: strict `>` first-max-wins (lowest index on an
//      exact tie) -- torch.argmax's tie-break convention
//
// Every dot product accumulates in ASCENDING input-index order (a fixed,
// deterministic op order), matching the determinism contract's "processed
// in a fixed order" spirit even though this module runs inside a match, not
// the resolve/ tick loop itself.

import { featurize } from './featurize.js';
import { detTanh } from './tanh.js';
import type { LinearLayer, PolicyWeights } from './weights-schema.js';

function applyLinear(layer: LinearLayer, input: readonly number[]): number[] {
  return layer.weight.map((row, outIndex) => {
    const bias = layer.bias[outIndex];
    if (bias === undefined) {
      throw new Error(`applyLinear: missing bias at output index ${outIndex}`);
    }
    let sum = bias;
    for (let inIndex = 0; inIndex < row.length; inIndex += 1) {
      const weight = row[inIndex];
      const value = input[inIndex];
      if (weight === undefined || value === undefined) {
        throw new Error(`applyLinear: missing weight/input at index ${inIndex}`);
      }
      sum += weight * value;
    }
    return sum;
  });
}

function applyTanhElementwise(vector: readonly number[]): number[] {
  return vector.map((value) => detTanh(value));
}

// The flat pre-split logits vector (length sum(nvec)) for `observation`
// under `weights` -- exported so the parity test can pin exact float64
// logits independent of the argmax step (a TS-refactor-catching snapshot).
export function computeActorLogits(weights: PolicyWeights, observation: readonly number[]): number[] {
  if (observation.length !== weights.obsDim) {
    throw new Error(
      `computeActorLogits: observation length ${observation.length} does not match obsDim ${weights.obsDim}`,
    );
  }
  const featurized = featurize(observation);
  const hidden1 = applyTanhElementwise(applyLinear(weights.trunk1, featurized));
  const hidden2 = applyTanhElementwise(applyLinear(weights.trunk2, hidden1));
  return applyLinear(weights.actorHead, hidden2);
}

function splitByNvec(logits: readonly number[], nvec: readonly number[]): number[][] {
  const segments: number[][] = [];
  let offset = 0;
  for (const size of nvec) {
    segments.push(logits.slice(offset, offset + size));
    offset += size;
  }
  return segments;
}

// Strict `>` first-max-wins: the lowest index wins an exact tie (torch.
// argmax's convention). The committed parity fixture's near-tie margin
// filter (marginEpsilon=0.01) means no committed case actually exercises
// tie-breaking, but a correct implementation still must not raise or pick
// the wrong side on one.
function argmax(values: readonly number[]): number {
  const first = values[0];
  if (first === undefined) {
    throw new Error('argmax: empty segment');
  }
  let bestIndex = 0;
  let bestValue = first;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      throw new Error(`argmax: missing value at index ${index}`);
    }
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  }
  return bestIndex;
}

// One argmax index per `weights.nvec` component, in nvec order (e.g.
// `[kind, targetSlot, skillIndex, moveX, moveY]` for policy-smoke-v1).
export function inferActionComponents(
  weights: PolicyWeights,
  observation: readonly number[],
): number[] {
  const logits = computeActorLogits(weights, observation);
  const segments = splitByNvec(logits, weights.nvec);
  return segments.map((segment) => argmax(segment));
}
