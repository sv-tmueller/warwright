import { createContentRegistry } from '../content/registry.js';
import type { ContentRegistry } from '../content/registry.js';
import { roles } from '../content/data/roles.js';
import { skills } from '../content/data/skills.js';
import {
  aggroLowestHp,
  focusCasters,
  policySmokeV1,
  protectAllies,
} from '../content/behaviors/index.js';

// Shared by init.ts and match.ts so the two can never assemble a different
// registry (roles, skills, and the seed Behaviors) and drift apart.
export function createSeedRegistry(): ContentRegistry {
  const registry = createContentRegistry();
  for (const role of roles) registry.loadRole(role);
  for (const skill of skills) registry.loadSkill(skill);
  registry.registerBehavior(aggroLowestHp);
  registry.registerBehavior(protectAllies);
  registry.registerBehavior(focusCasters);
  registry.registerBehavior(policySmokeV1);
  return registry;
}
