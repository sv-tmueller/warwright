import type { Skill } from '../schemas.js';

export const skills = [
  {
    id: 'shield-bash',
    name: 'Shield Bash',
    cooldownTicks: 40,
    rangeSquared: 400,
    target: 'enemy',
    effect: { kind: 'direct-damage', amount: 12 },
  },
  {
    id: 'guardian-ward',
    name: 'Guardian Ward',
    cooldownTicks: 80,
    rangeSquared: 2500,
    target: 'ally',
    effect: { kind: 'apply-status', status: 'shield', durationTicks: 100, magnitude: 40 },
  },
  {
    id: 'cleave',
    name: 'Cleave',
    cooldownTicks: 30,
    rangeSquared: 900,
    target: 'enemy',
    effect: { kind: 'direct-damage', amount: 30 },
  },
  {
    id: 'frost-bolt',
    name: 'Frost Bolt',
    cooldownTicks: 35,
    rangeSquared: 40000,
    target: 'enemy',
    effect: { kind: 'apply-status', status: 'slow', durationTicks: 60, magnitude: 1 },
  },
  {
    id: 'venom-shot',
    name: 'Venom Shot',
    cooldownTicks: 45,
    rangeSquared: 40000,
    target: 'enemy',
    effect: { kind: 'apply-status', status: 'dot', durationTicks: 100, magnitude: 3 },
  },
  {
    id: 'mending-touch',
    name: 'Mending Touch',
    cooldownTicks: 50,
    rangeSquared: 40000,
    target: 'ally',
    effect: { kind: 'heal', amount: 25 },
  },
] satisfies readonly Skill[];
