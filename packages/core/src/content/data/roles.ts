import type { Role } from '../schemas.js';

export const roles = [
  {
    id: 'vanguard',
    name: 'Vanguard',
    maxHp: 200,
    armor: 10,
    moveSpeed: 3,
    attack: { damage: 8, rangeSquared: 400, cooldownTicks: 20 },
  },
  {
    id: 'warden',
    name: 'Warden',
    maxHp: 90,
    armor: 2,
    moveSpeed: 4,
    attack: { damage: 10, rangeSquared: 40000, cooldownTicks: 25 },
  },
  {
    id: 'reaver',
    name: 'Reaver',
    maxHp: 110,
    armor: 3,
    moveSpeed: 6,
    attack: { damage: 22, rangeSquared: 900, cooldownTicks: 30 },
  },
  {
    id: 'mender',
    name: 'Mender',
    maxHp: 80,
    armor: 1,
    moveSpeed: 4,
    attack: { damage: 4, rangeSquared: 40000, cooldownTicks: 30 },
  },
] satisfies readonly Role[];
