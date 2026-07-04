import { z } from 'zod';
import { ARENA_MAX_X, ARENA_MAX_Y, ARENA_MIN_X, ARENA_MIN_Y } from '../sim/constants.js';
import { STATUS_KINDS } from '../sim/vocab.js';
import type { EffectKind } from '../sim/vocab.js';

// Targeting is schema-layer vocabulary (not part of the P0-02 sim vocab):
// the frozen contract is "the P0-02 enums plus the P0-04 effect schema".
export const TARGET_KINDS = ['enemy', 'ally', 'self'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const RoleIdSchema = z.string().min(1);
export const SkillIdSchema = z.string().min(1);
export const BehaviorIdSchema = z.string().min(1);

export const PositionSchema = z.strictObject({
  x: z.int().min(ARENA_MIN_X).max(ARENA_MAX_X),
  y: z.int().min(ARENA_MIN_Y).max(ARENA_MAX_Y),
});

export const RoleSchema = z.strictObject({
  id: RoleIdSchema,
  name: z.string().min(1),
  maxHp: z.int().positive(),
  armor: z.int().nonnegative(),
  moveSpeed: z.int().positive(),
  attack: z.strictObject({
    damage: z.int().positive(),
    rangeSquared: z.int().positive(),
    cooldownTicks: z.int().positive(),
  }),
});

export const SkillEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('direct-damage' satisfies EffectKind),
    amount: z.int().positive(),
  }),
  z.strictObject({
    kind: z.literal('heal' satisfies EffectKind),
    amount: z.int().positive(),
  }),
  z.strictObject({
    kind: z.literal('apply-status' satisfies EffectKind),
    status: z.enum(STATUS_KINDS),
    durationTicks: z.int().positive(),
    // Interpreted per status kind: shield = absorb pool in hp, dot = damage
    // per tick, slow = movement reduction. Exact semantics owned by P0-07;
    // this schema only stores a single positive integer.
    magnitude: z.int().positive(),
  }),
]);

export const SkillSchema = z.strictObject({
  id: SkillIdSchema,
  name: z.string().min(1),
  cooldownTicks: z.int().nonnegative(),
  rangeSquared: z.int().nonnegative(),
  target: z.enum(TARGET_KINDS),
  effect: SkillEffectSchema,
});

export const UnitBuildSchema = z.strictObject({
  roleId: RoleIdSchema,
  skillIds: z.array(SkillIdSchema),
  behaviorId: BehaviorIdSchema,
  position: PositionSchema,
});

export const WarbandSchema = z.strictObject({
  name: z.string().min(1),
  units: z.array(UnitBuildSchema).min(1),
});

export type Role = z.infer<typeof RoleSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type SkillEffect = z.infer<typeof SkillEffectSchema>;
export type UnitBuild = z.infer<typeof UnitBuildSchema>;
export type Warband = z.infer<typeof WarbandSchema>;

function parseWith<T>(schema: z.ZodType<T>, schemaName: string, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid ${schemaName}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function parseRole(data: unknown): Role {
  return parseWith(RoleSchema, 'Role', data);
}

export function parseSkill(data: unknown): Skill {
  return parseWith(SkillSchema, 'Skill', data);
}

export function parseWarband(data: unknown): Warband {
  return parseWith(WarbandSchema, 'Warband', data);
}
