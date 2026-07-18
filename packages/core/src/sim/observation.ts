// Pure projection over WorldState/Action for the gym bridge (#63,
// packages/gym-bridge) and, later, exported inference Behaviors. This is
// NOT resolve logic: it reads WorldState and turns it into flat number[]
// vectors (and turns tagged integer tuples back into Actions); it never
// computes combat outcomes, applies effects, or advances the simulation.
// Lives under sim/ (not api/) specifically so the determinism scan and the
// sim/ ESLint override (integer-only math, no wall-clock access, etc.)
// cover it too, matching the determinism contract in CLAUDE.md: all fields
// below are plain integers and distances are SQUARED, never sqrt'd.
//
// OBS_ENCODING_VERSION is the parity ground truth for every future exported
// policy (see CLAUDE.md "Content, learned behaviors, and cosmetics"): once
// a version ships, ANY layout change here (field order, field count, the
// action tag table) is a breaking migration and must bump this constant.

import { skills as skillCatalog } from '../content/data/skills.js';
import type { Action } from './behavior.js';
import type { Unit, WorldState } from './types.js';

export const OBS_ENCODING_VERSION = 1;

// Sentinel written into a self-block skill-cooldown slot when the unit does
// not have that catalog skill equipped. Ticks are always >= 0, so -1 can
// never collide with a real cooldown value.
const SKILL_COOLDOWN_ABSENT = -1;

// --- Self block (one per encodeObservation call) -------------------------
// Field order, indices 0..OBS_SELF_FIELD_COUNT-1:
export const OBS_SELF_HP_INDEX = 0;
export const OBS_SELF_MAX_HP_INDEX = 1;
export const OBS_SELF_POS_X_INDEX = 2;
export const OBS_SELF_POS_Y_INDEX = 3;
export const OBS_SELF_ATTACK_COOLDOWN_INDEX = 4;
// Slots [OBS_SELF_SKILL_COOLDOWN_START_INDEX, OBS_SELF_FIELD_COUNT) hold one
// cooldownRemaining slot per skill catalog entry (packages/core/src/content
// /data/skills.ts), in that fixed catalog order -- NOT per-unit skillIds
// order. This keeps the self-block length constant across every unit
// regardless of its build, so any two units are directly comparable
// slot-for-slot. A catalog skill the unit does not have equipped reads
// SKILL_COOLDOWN_ABSENT (-1) in its slot.
export const OBS_SELF_SKILL_COOLDOWN_START_INDEX = 5;
export const OBS_SELF_FIELD_COUNT = OBS_SELF_SKILL_COOLDOWN_START_INDEX + skillCatalog.length;

// --- Per-unit block (one per ally, then one per enemy, ascending id) -----
// Field order within each OBS_UNIT_FIELD_COUNT-length block:
export const OBS_UNIT_ID_OFFSET = 0;
export const OBS_UNIT_HP_OFFSET = 1;
export const OBS_UNIT_MAX_HP_OFFSET = 2;
export const OBS_UNIT_POS_X_OFFSET = 3;
export const OBS_UNIT_POS_Y_OFFSET = 4;
// Squared distance to the observed unit (`self`), integer math per the
// determinism contract -- never a square root or hypotenuse function.
export const OBS_UNIT_DISTANCE_SQUARED_OFFSET = 5;
export const OBS_UNIT_FIELD_COUNT = 6;

function squaredDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function encodeSelfBlock(self: Unit): number[] {
  const block = new Array<number>(OBS_SELF_FIELD_COUNT).fill(SKILL_COOLDOWN_ABSENT);
  block[OBS_SELF_HP_INDEX] = self.hp;
  block[OBS_SELF_MAX_HP_INDEX] = self.maxHp;
  block[OBS_SELF_POS_X_INDEX] = self.pos.x;
  block[OBS_SELF_POS_Y_INDEX] = self.pos.y;
  block[OBS_SELF_ATTACK_COOLDOWN_INDEX] = self.attackCooldownRemaining;

  for (const skillState of self.skills) {
    const catalogIndex = skillCatalog.findIndex((skill) => skill.id === skillState.skillId);
    // Every equipped skillId was validated against the catalog at build
    // time (content/schemas.ts + the registry); -1 here would mean stale
    // content data, not a caller error, so this is defensive only.
    if (catalogIndex === -1) continue;
    block[OBS_SELF_SKILL_COOLDOWN_START_INDEX + catalogIndex] = skillState.cooldownRemaining;
  }

  return block;
}

function encodeUnitBlock(other: Unit, self: Unit): number[] {
  const block = new Array<number>(OBS_UNIT_FIELD_COUNT);
  block[OBS_UNIT_ID_OFFSET] = other.id;
  block[OBS_UNIT_HP_OFFSET] = other.hp;
  block[OBS_UNIT_MAX_HP_OFFSET] = other.maxHp;
  block[OBS_UNIT_POS_X_OFFSET] = other.pos.x;
  block[OBS_UNIT_POS_Y_OFFSET] = other.pos.y;
  block[OBS_UNIT_DISTANCE_SQUARED_OFFSET] = squaredDistance(
    self.pos.x,
    self.pos.y,
    other.pos.x,
    other.pos.y,
  );
  return block;
}

// Fixed-order flat observation vector for `unitId`: the self block (hp,
// maxHp, pos, attack cooldown, per-catalog-skill cooldowns), then one block
// per ALLY in ascending id order (excluding self), then one block per ENEMY
// in ascending id order. `world.units` is already ascending-id ordered (see
// sim/types.ts) and dead units (hp <= 0) are never removed from it, so a
// given match's observation length is constant across every tick of that
// match, win or lose.
export function encodeObservation(world: WorldState, unitId: number): number[] {
  const self = world.units.find((unit) => unit.id === unitId);
  if (self === undefined) {
    throw new Error(`encodeObservation: no unit with id ${unitId}`);
  }

  const vector = encodeSelfBlock(self);
  for (const unit of world.units) {
    if (unit.id === self.id || unit.team !== self.team) continue;
    vector.push(...encodeUnitBlock(unit, self));
  }
  for (const unit of world.units) {
    if (unit.team === self.team) continue;
    vector.push(...encodeUnitBlock(unit, self));
  }
  return vector;
}

// Tagged integer tuple encoding for the Action union (sim/behavior.ts).
// Every tuple is [kindCode, p1, p2, p3]; unused slots are 0. Python mirrors
// ONLY this kind-code table, never any rule:
//   idle:         [0, 0,        0,    0]
//   move:         [1, to.x,     to.y, 0]
//   move-toward:  [2, targetId, 0,    0]
//   attack:       [3, targetId, 0,    0]
//   cast:         [4, targetId, 0,    skillIndex]  (skillIndex: skill
//                                                    catalog position, see
//                                                    skillCatalog above)
const ACTION_KIND_IDLE = 0;
const ACTION_KIND_MOVE = 1;
const ACTION_KIND_MOVE_TOWARD = 2;
const ACTION_KIND_ATTACK = 3;
const ACTION_KIND_CAST = 4;

export function encodeAction(action: Action): number[] {
  switch (action.kind) {
    case 'idle':
      return [ACTION_KIND_IDLE, 0, 0, 0];
    case 'move':
      return [ACTION_KIND_MOVE, action.to.x, action.to.y, 0];
    case 'move-toward':
      return [ACTION_KIND_MOVE_TOWARD, action.targetId, 0, 0];
    case 'attack':
      return [ACTION_KIND_ATTACK, action.targetId, 0, 0];
    case 'cast': {
      const skillIndex = skillCatalog.findIndex((skill) => skill.id === action.skillId);
      if (skillIndex === -1) {
        throw new Error(`encodeAction: unknown skillId "${action.skillId}"`);
      }
      return [ACTION_KIND_CAST, action.targetId, 0, skillIndex];
    }
  }
}

// A slot the given kind does not use MUST be 0 on the wire (see the tag
// table above): `[2, 7, 9, 9]` (move-toward with a stray p2/p3) must fail
// loud, not decode leniently, since encodeAction never emits anything but 0
// there and a non-zero unused slot means the wire producer disagrees with
// this codec about the layout. Pinned at OBS_ENCODING_VERSION 1, before any
// wire range is locked in for real clients.
function assertUnusedSlotsAreZero(
  encoded: readonly [number, number, number, number],
  usedIndices: readonly number[],
): void {
  for (let index = 1; index < encoded.length; index++) {
    if (usedIndices.includes(index)) continue;
    if (encoded[index] !== 0) {
      throw new Error(
        `decodeAction: unused slot ${index} must be 0, got ${encoded[index]} (encoded: ${JSON.stringify(encoded)})`,
      );
    }
  }
}

export function decodeAction(encoded: readonly number[]): Action {
  if (encoded.length !== 4) {
    throw new Error(`decodeAction: expected a 4-element tuple, got length ${encoded.length}`);
  }
  const tuple = encoded as [number, number, number, number];
  const [kindCode, p1, p2, p3] = tuple;

  switch (kindCode) {
    case ACTION_KIND_IDLE:
      assertUnusedSlotsAreZero(tuple, []);
      return { kind: 'idle' };
    case ACTION_KIND_MOVE:
      assertUnusedSlotsAreZero(tuple, [1, 2]);
      return { kind: 'move', to: { x: p1, y: p2 } };
    case ACTION_KIND_MOVE_TOWARD:
      assertUnusedSlotsAreZero(tuple, [1]);
      return { kind: 'move-toward', targetId: p1 };
    case ACTION_KIND_ATTACK:
      assertUnusedSlotsAreZero(tuple, [1]);
      return { kind: 'attack', targetId: p1 };
    case ACTION_KIND_CAST: {
      assertUnusedSlotsAreZero(tuple, [1, 3]);
      const skill = skillCatalog[p3];
      if (skill === undefined) {
        throw new Error(`decodeAction: unknown skill index ${p3}`);
      }
      return { kind: 'cast', skillId: skill.id, targetId: p1 };
    }
    default:
      throw new Error(`decodeAction: unknown action kind code ${kindCode}`);
  }
}
