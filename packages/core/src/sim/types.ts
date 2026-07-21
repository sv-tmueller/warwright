import type { Rng } from './prng.js';
import type { MatchEvent } from './events.js';

export type TeamId = 'A' | 'B';

// A draw covers the tick-cap outcome (see the loop, added later in the
// milestone).
export type Winner = TeamId | 'draw';

// Integer coordinates on the arena bounds (see constants.ts).
export type Position = {
  x: number;
  y: number;
};

// Ticks; 0 means the skill is ready.
export type SkillState = {
  skillId: string;
  cooldownRemaining: number;
};

// Shared shape for the slow, shield, stun, and empower statuses. For slow,
// magnitude is an integer percent reduction 0-100 applied with integer
// division. For shield, magnitude is the remaining absorb pool, decremented
// by damage; the status expires when either field reaches 0. For stun,
// magnitude is carried but unread (the unit simply takes no action while
// stunned). For empower, magnitude is an integer percent bonus applied with
// integer division to basic-attack damage at attack resolution and to move
// speed at move resolution.
export type StatusState = {
  magnitude: number;
  remainingTicks: number;
};

export type DotState = {
  damagePerTick: number;
  remainingTicks: number;
};

// No `alive` flag: dead means hp <= 0. Units stay in the array (stable ids,
// ascending order) and the loop skips them.
export type Unit = {
  id: number;
  team: TeamId;
  roleId: string;
  behaviorId: string;

  maxHp: number;
  hp: number;
  armor: number;
  moveSpeed: number;
  attackDamage: number;
  attackRangeSquared: number;
  attackCooldownTicks: number;
  attackCooldownRemaining: number;

  pos: Position;
  skills: SkillState[];

  slow: StatusState | null;
  shield: StatusState | null;
  stun: StatusState | null;
  empower: StatusState | null;
  activeDots: DotState[];
};

export type WorldState = {
  version: number;
  seed: number;
  tick: number;
  units: Unit[];
  eventLog: MatchEvent[];
  rng: Rng;
};

export type MatchResult = {
  version: number;
  seed: number;
  winner: Winner;
  eventLog: MatchEvent[];
  hash: number;
};

// Builds are `unknown` deliberately: the replay tuple is
// {version, seed, buildA, buildB} and validation against the Zod Warband
// schema happens inside init, keeping this file free of any content import.
export type RunMatch = (input: {
  version: number;
  seed: number;
  buildA: unknown;
  buildB: unknown;
}) => MatchResult;
