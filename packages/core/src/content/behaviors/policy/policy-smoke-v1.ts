// The exported inference Behavior for the #66a/#66b policy-smoke-v1
// checkpoint (see gym/EXPORT.md and gym/warwright_gym/training/smoke_run.py
// for its training build pair: a lone reaver+cleave agent vs. a single
// warden). Draws NO RNG -- inference is a pure, deterministic function of
// the observation.
import type { Action, Behavior, UnitView, WorldView } from '../../../sim/behavior.js';
import {
  ACTION_KIND_ATTACK,
  ACTION_KIND_CAST,
  ACTION_KIND_IDLE,
  ACTION_KIND_MOVE,
  ACTION_KIND_MOVE_TOWARD,
  OBS_SELF_FIELD_COUNT,
  OBS_UNIT_FIELD_COUNT,
  OBS_UNIT_ID_OFFSET,
  decodeAction,
} from '../../../sim/observation.js';
import { inferActionComponents } from './inference.js';
import { policySmokeV1Weights } from './weights-schema.js';
import type { PolicyWeights } from './weights-schema.js';

// nvec component index order: [kind, targetSlot, skillIndex, moveX, moveY]
// (see gym/EXPORT.md's TS mirror contract, step 7).
const KIND_COMPONENT = 0;
const TARGET_SLOT_COMPONENT = 1;
const SKILL_INDEX_COMPONENT = 2;
const MOVE_X_COMPONENT = 3;
const MOVE_Y_COMPONENT = 4;

// Mirrors gym/warwright_gym/env.py's WarwrightVectorEnv._extract_agent_vector:
// a target slot's unit id lives in the observation's own unit-block layout,
// read once per decide call (never cached -- ids/slots can shift as units
// die across the match).
function targetIdForSlot(observation: readonly number[], slot: number): number {
  const index = OBS_SELF_FIELD_COUNT + slot * OBS_UNIT_FIELD_COUNT + OBS_UNIT_ID_OFFSET;
  const targetId = observation[index];
  if (targetId === undefined) {
    throw new Error(
      `policy-smoke-v1: target slot ${slot} (observation index ${index}) is out of range for ` +
        `an observation of length ${observation.length}`,
    );
  }
  return targetId;
}

// Factored out from the exported `policySmokeV1` Behavior so tests can
// exercise the wiring (action-kind -> wire-tuple mapping) against a small
// synthetic PolicyWeights instead of the full committed network.
// Draws no RNG, so the returned function's arity is 2, not 3: TS structural
// typing accepts this as a Behavior['decide'] (a function type is satisfied
// by an implementation that ignores trailing parameters -- same rule that
// lets `Array.prototype.map`'s callback omit the index/array arguments).
export function createPolicySmokeV1Decide(weights: PolicyWeights): Behavior['decide'] {
  return function decide(self: UnitView, world: WorldView): Action {
    const observation = world.observationOf(self);
    if (observation.length !== weights.obsDim) {
      throw new Error(
        `policy-smoke-v1: observation length ${observation.length} does not match the trained ` +
          `obsDim ${weights.obsDim}. This Behavior was exported for a fixed roster shape (0 ` +
          `allies, 1 enemy, per gym/warwright_gym/training/smoke_run.py's build pair); a build ` +
          `with a different roster shape produces a differently-shaped observation the policy ` +
          `was never trained on.`,
      );
    }

    const components = inferActionComponents(weights, observation);
    const kind = components[KIND_COMPONENT];
    const targetSlot = components[TARGET_SLOT_COMPONENT];
    const skillIndex = components[SKILL_INDEX_COMPONENT];
    const moveX = components[MOVE_X_COMPONENT];
    const moveY = components[MOVE_Y_COMPONENT];
    if (
      kind === undefined ||
      targetSlot === undefined ||
      skillIndex === undefined ||
      moveX === undefined ||
      moveY === undefined
    ) {
      throw new Error(
        `policy-smoke-v1: inference produced ${components.length} action components, expected 5`,
      );
    }

    // Mirrors gym/warwright_gym/env.py's _encode_wire_action exactly.
    if (kind === ACTION_KIND_IDLE) {
      return decodeAction([ACTION_KIND_IDLE, 0, 0, 0]);
    }
    if (kind === ACTION_KIND_MOVE) {
      return decodeAction([ACTION_KIND_MOVE, moveX, moveY, 0]);
    }

    const targetId = targetIdForSlot(observation, targetSlot);
    if (kind === ACTION_KIND_MOVE_TOWARD) {
      return decodeAction([ACTION_KIND_MOVE_TOWARD, targetId, 0, 0]);
    }
    if (kind === ACTION_KIND_ATTACK) {
      return decodeAction([ACTION_KIND_ATTACK, targetId, 0, 0]);
    }
    if (kind === ACTION_KIND_CAST) {
      return decodeAction([ACTION_KIND_CAST, targetId, 0, skillIndex]);
    }

    throw new Error(`policy-smoke-v1: unknown action kind ${kind}`);
  };
}

export const policySmokeV1: Behavior = {
  id: 'policy-smoke-v1',
  decide: createPolicySmokeV1Decide(policySmokeV1Weights),
};
