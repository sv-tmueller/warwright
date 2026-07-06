import type { Rng } from './prng.js';
import type { Position, TeamId } from './types.js';

// Read-only projection of a unit's SkillState (types.ts).
export type SkillView = {
  readonly skillId: string;
  readonly cooldownRemaining: number; // ticks; 0 = ready
};

// Read-only projection of a Unit. References content by id only and exposes
// exactly the runtime stats the three P0-10 behaviors read.
export type UnitView = {
  readonly id: number;
  readonly team: TeamId;
  readonly roleId: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly pos: Readonly<Position>;
  readonly skills: readonly SkillView[];
  readonly attackRangeSquared: number;
};

// Team-relative, read-only queries. Both return LIVING units (hp > 0) in
// ascending id order (the determinism processing order). alliesOf excludes self.
export type WorldView = {
  alliesOf(self: UnitView): readonly UnitView[];
  enemiesOf(self: UnitView): readonly UnitView[];
};

// Frozen intent union consumed by the P0-13 tick loop.
export type Action =
  | { readonly kind: 'idle' }
  | { readonly kind: 'move'; readonly to: Position }
  | { readonly kind: 'move-toward'; readonly targetId: number }
  | { readonly kind: 'attack'; readonly targetId: number }
  | { readonly kind: 'cast'; readonly skillId: string; readonly targetId: number };

export type Behavior = {
  readonly id: string;
  decide(self: UnitView, world: WorldView, rng: Rng): Action;
};
