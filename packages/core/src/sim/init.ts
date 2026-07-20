import { parseWarband } from '../content/schemas.js';
import type { UnitBuild } from '../content/schemas.js';
import { createContentRegistry } from '../content/registry.js';
import { createSeedRegistry } from './seed-registry.js';
import { EXTERNAL_BEHAVIOR_ID } from './constants.js';
import { mulberry32 } from './prng.js';
import { emit } from './events.js';
import type { SpawnInfo } from './events.js';
import type { TeamId, Unit, WorldState } from './types.js';

function buildUnit(
  id: number,
  team: TeamId,
  build: UnitBuild,
  registry: ReturnType<typeof createContentRegistry>,
): Unit {
  const role = registry.getRole(build.roleId);
  const skillStates = build.skillIds.map((skillId) => {
    registry.getSkill(skillId);
    return { skillId, cooldownRemaining: 0 };
  });
  // Skip the eager lookup only for the external sentinel: those units draw
  // their Action from stepTick's externalActions map, never a registered
  // Behavior, so they legitimately have no entry in the registry.
  if (build.behaviorId !== EXTERNAL_BEHAVIOR_ID) {
    registry.getBehavior(build.behaviorId);
  }

  return {
    id,
    team,
    roleId: build.roleId,
    behaviorId: build.behaviorId,
    maxHp: role.maxHp,
    hp: role.maxHp,
    armor: role.armor,
    moveSpeed: role.moveSpeed,
    attackDamage: role.attack.damage,
    attackRangeSquared: role.attack.rangeSquared,
    attackCooldownTicks: role.attack.cooldownTicks,
    attackCooldownRemaining: 0,
    pos: build.position,
    skills: skillStates,
    slow: null,
    shield: null,
    activeDots: [],
  };
}

// Shared by init (the zero-extras entry point) and createSteppedMatch (which
// passes a registry built via createSeedRegistryWith so units may reference
// an injected Behavior's id). Kept as a sibling export rather than an
// optional param on `init` so `init`'s signature and behavior stay
// byte-identical for every existing caller.
export function initWithRegistry(
  version: number,
  seed: number,
  buildA: unknown,
  buildB: unknown,
  registry: ReturnType<typeof createContentRegistry>,
): WorldState {
  const parsedA = parseWarband(buildA);
  const parsedB = parseWarband(buildB);

  let nextId = 0;
  const units: Unit[] = [];
  for (const build of parsedA.units) {
    units.push(buildUnit(nextId++, 'A', build, registry));
  }
  for (const build of parsedB.units) {
    units.push(buildUnit(nextId++, 'B', build, registry));
  }

  const spawnInfos: SpawnInfo[] = units.map((unit) => ({
    id: unit.id,
    team: unit.team,
    roleId: unit.roleId,
    pos: unit.pos,
    hp: unit.hp,
    maxHp: unit.maxHp,
  }));

  const eventLog: WorldState['eventLog'] = [];
  emit(eventLog, { kind: 'match-start', tick: 0, version, seed, units: spawnInfos });

  return { version, seed, tick: 0, units, eventLog, rng: mulberry32(seed) };
}

export function init(version: number, seed: number, buildA: unknown, buildB: unknown): WorldState {
  return initWithRegistry(version, seed, buildA, buildB, createSeedRegistry());
}
