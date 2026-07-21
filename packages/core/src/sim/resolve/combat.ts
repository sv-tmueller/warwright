import { emit } from '../events.js';
import type { MatchEvent } from '../events.js';
import type { Unit } from '../types.js';
import { isInRange } from './geometry.js';

export function dealDamage(
  target: Unit,
  rawAmount: number,
  sourceId: number | null,
  log: MatchEvent[],
  tick: number,
): void {
  const wasAlive = target.hp > 0;

  const afterArmor = Math.max(rawAmount - target.armor, 0);

  let absorbed = 0;
  if (target.shield !== null) {
    absorbed = Math.min(afterArmor, target.shield.magnitude);
    target.shield.magnitude -= absorbed;
  }

  const toHp = afterArmor - absorbed;
  target.hp = Math.max(target.hp - toHp, 0);

  emit(log, {
    kind: 'damage',
    tick,
    sourceId,
    targetId: target.id,
    amount: afterArmor,
    absorbed,
    hpAfter: target.hp,
  });

  if (wasAlive && target.hp <= 0) {
    emit(log, { kind: 'death', tick, unitId: target.id });
  }
}

export function heal(
  target: Unit,
  amount: number,
  sourceId: number,
  log: MatchEvent[],
  tick: number,
): void {
  const before = target.hp;
  target.hp = Math.min(target.hp + amount, target.maxHp);
  const actual = target.hp - before;

  emit(log, {
    kind: 'heal',
    tick,
    sourceId,
    targetId: target.id,
    amount: actual,
    hpAfter: target.hp,
  });
}

export function applyActiveDots(unit: Unit, log: MatchEvent[], tick: number): void {
  for (const dot of unit.activeDots) {
    dealDamage(unit, dot.damagePerTick, null, log, tick);
  }
}

export function resolveAttack(
  attacker: Unit,
  target: Unit,
  log: MatchEvent[],
  tick: number,
): boolean {
  if (attacker.attackCooldownRemaining > 0) return false;
  if (!isInRange(attacker.pos, target.pos, attacker.attackRangeSquared)) return false;

  emit(log, { kind: 'attack', tick, unitId: attacker.id, targetId: target.id });
  const damage =
    attacker.empower === null
      ? attacker.attackDamage
      : Math.trunc((attacker.attackDamage * (100 + attacker.empower.magnitude)) / 100);
  dealDamage(target, damage, attacker.id, log, tick);
  attacker.attackCooldownRemaining = attacker.attackCooldownTicks;

  return true;
}

export function tickCooldowns(unit: Unit): void {
  unit.attackCooldownRemaining = Math.max(unit.attackCooldownRemaining - 1, 0);
  for (const skill of unit.skills) {
    skill.cooldownRemaining = Math.max(skill.cooldownRemaining - 1, 0);
  }
}
