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
  // Slice C (#149): appended, never reorder the six skills above -- catalog
  // order is the OBS_ENCODING_VERSION-pinned skill-cooldown-slot layout
  // (see sim/observation.ts), and reordering an existing entry would shift
  // every later slot for anything already trained against OBS_ENCODING_VERSION 1.
  {
    id: 'piercing-shot',
    name: 'Piercing Shot',
    cooldownTicks: 50,
    rangeSquared: 40000,
    target: 'enemy',
    effect: { kind: 'direct-damage', amount: 22 },
  },
  {
    id: 'battle-cry',
    name: 'Battle Cry',
    cooldownTicks: 40,
    rangeSquared: 2500,
    target: 'ally',
    effect: { kind: 'apply-status', status: 'shield', durationTicks: 80, magnitude: 25 },
  },
  {
    id: 'crippling-strike',
    name: 'Crippling Strike',
    cooldownTicks: 100,
    rangeSquared: 900,
    target: 'enemy',
    // magnitude 1: positive-int placeholder (schema requires a positive
    // int); stun gating is presence-only, sim/loop.ts never reads it (see
    // resolve/status.ts).
    effect: { kind: 'apply-status', status: 'stun', durationTicks: 20, magnitude: 1 },
  },
  {
    id: 'rally',
    name: 'Rally',
    cooldownTicks: 80,
    rangeSquared: 2500,
    target: 'ally',
    // magnitude 25: +25% attack/move bonus for 60 ticks (3s), applied at
    // attack resolution (resolve/combat.ts) and move resolution
    // (resolve/movement.ts) only -- see resolve/status.ts's 'empower' case.
    effect: { kind: 'apply-status', status: 'empower', durationTicks: 60, magnitude: 25 },
  },
] satisfies readonly Skill[];
