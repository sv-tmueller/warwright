import type { ContentRegistry } from '../content/registry.js';
import type { Action, UnitView, WorldView } from './behavior.js';
import { EXTERNAL_BEHAVIOR_ID } from './constants.js';
import { emit } from './events.js';
import { applyActiveDots, resolveAttack, tickCooldowns } from './resolve/combat.js';
import { isInRange } from './resolve/geometry.js';
import { moveUnitToward } from './resolve/movement.js';
import { resolveSkillEffect } from './resolve/skills.js';
import { tickStatuses } from './resolve/status.js';
import { encodeObservationFromUnits } from './observation.js';
import type { Unit, WorldState, Winner } from './types.js';

function toUnitView(unit: Unit): UnitView {
  return {
    id: unit.id,
    team: unit.team,
    roleId: unit.roleId,
    hp: unit.hp,
    maxHp: unit.maxHp,
    pos: unit.pos,
    skills: unit.skills.map((skill) => ({
      skillId: skill.skillId,
      cooldownRemaining: skill.cooldownRemaining,
    })),
    attackRangeSquared: unit.attackRangeSquared,
  };
}

// Closures over the live `units` array so a unit's mid-tick death (earlier
// in the same action phase) is visible to units decided later in that phase.
function buildWorldView(units: Unit[]): WorldView {
  function living(): Unit[] {
    return units.filter((unit) => unit.hp > 0);
  }

  return {
    alliesOf(self) {
      return living()
        .filter((unit) => unit.team === self.team && unit.id !== self.id)
        .map(toUnitView);
    },
    enemiesOf(self) {
      return living()
        .filter((unit) => unit.team !== self.team)
        .map(toUnitView);
    },
    observationOf(self) {
      // Over ALL of `units`, dead ones included -- matches
      // sim/observation.ts's encodeObservation exactly (training's obs
      // layout), unlike alliesOf/enemiesOf's living-only view above.
      return encodeObservationFromUnits(units, self.id);
    },
  };
}

function findUnitById(units: Unit[], id: number): Unit | undefined {
  return units.find((unit) => unit.id === id);
}

function applyAction(
  world: WorldState,
  registry: ContentRegistry,
  unit: Unit,
  action: Action,
  tick: number,
): void {
  if (action.kind === 'idle') {
    return;
  }

  if (action.kind === 'move') {
    moveUnitToward(unit, action.to, world.eventLog, tick);
    return;
  }

  if (action.kind === 'move-toward') {
    const target = findUnitById(world.units, action.targetId);
    if (!target) return;
    moveUnitToward(unit, target.pos, world.eventLog, tick);
    return;
  }

  if (action.kind === 'attack') {
    const target = findUnitById(world.units, action.targetId);
    if (!target) return;
    resolveAttack(unit, target, world.eventLog, tick);
    return;
  }

  // action.kind === 'cast': resolveSkillEffect has no gating of its own, so
  // the loop enforces cooldown and range before invoking it.
  const target = findUnitById(world.units, action.targetId);
  if (!target) return;

  const skillState = unit.skills.find((skill) => skill.skillId === action.skillId);
  if (!skillState || skillState.cooldownRemaining > 0) return;

  const skill = registry.getSkill(action.skillId);
  if (!isInRange(unit.pos, target.pos, skill.rangeSquared)) return;

  resolveSkillEffect(unit, target, action.skillId, skill.effect, world.eventLog, tick);
  skillState.cooldownRemaining = skill.cooldownTicks;
}

export function checkWinner(units: readonly Unit[]): Winner | null {
  const aliveA = units.some((unit) => unit.team === 'A' && unit.hp > 0);
  const aliveB = units.some((unit) => unit.team === 'B' && unit.hp > 0);

  if (aliveA && aliveB) return null;
  if (aliveA) return 'A';
  if (aliveB) return 'B';
  return 'draw';
}

export function stepTick(
  world: WorldState,
  registry: ContentRegistry,
  externalActions?: ReadonlyMap<number, Action>,
): Winner | null {
  world.tick += 1;
  const tick = world.tick;
  const worldView = buildWorldView(world.units);

  for (const unit of world.units) {
    if (unit.hp <= 0) continue;

    let action: Action;
    if (unit.behaviorId === EXTERNAL_BEHAVIOR_ID) {
      const injected = externalActions?.get(unit.id);
      if (!injected) {
        throw new Error(
          `stepTick: no external action supplied for living external unit ${unit.id}`,
        );
      }
      action = injected;
    } else {
      const behavior = registry.getBehavior(unit.behaviorId);
      action = behavior.decide(toUnitView(unit), worldView, world.rng);
    }

    applyAction(world, registry, unit, action, tick);
  }

  for (const unit of world.units) {
    if (unit.hp <= 0) continue;
    applyActiveDots(unit, world.eventLog, tick);
    tickStatuses(unit, world.eventLog, tick);
    tickCooldowns(unit);
  }

  const winner = checkWinner(world.units);
  emit(world.eventLog, { kind: 'tick', tick });
  return winner;
}
