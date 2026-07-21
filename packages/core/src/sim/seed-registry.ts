import { createContentRegistry } from '../content/registry.js';
import type { ContentRegistry } from '../content/registry.js';
import { roles } from '../content/data/roles.js';
import { skills } from '../content/data/skills.js';
import { augments } from '../content/data/augments.js';
import {
  aggroLowestHp,
  focusCasters,
  policySmokeV1,
  protectAllies,
} from '../content/behaviors/index.js';
import type { Behavior } from './behavior.js';

// Shared by init.ts and match.ts so the two can never assemble a different
// registry (roles, skills, and the seed Behaviors) and drift apart.
//
// `extra` Behaviors are registered AFTER the seed set, via
// ContentRegistry.registerBehavior, which throws loud on a duplicate id
// (see content/registry.ts) -- so a submission whose id collides with a
// seed Behavior fails fast instead of silently shadowing it. This seam is
// additive and unused by createSeedRegistry's zero-arg callers (runMatch
// included): it exists for packages/foundry (#135) to run a third-party
// Behavior inside the real core loop without re-implementing rules.
export function createSeedRegistryWith(extra: readonly Behavior[]): ContentRegistry {
  const registry = createContentRegistry();
  for (const role of roles) registry.loadRole(role);
  for (const skill of skills) registry.loadSkill(skill);
  for (const augment of augments) registry.loadAugment(augment);
  registry.registerBehavior(aggroLowestHp);
  registry.registerBehavior(protectAllies);
  registry.registerBehavior(focusCasters);
  registry.registerBehavior(policySmokeV1);
  for (const behavior of extra) registry.registerBehavior(behavior);
  return registry;
}

export function createSeedRegistry(): ContentRegistry {
  return createSeedRegistryWith([]);
}
