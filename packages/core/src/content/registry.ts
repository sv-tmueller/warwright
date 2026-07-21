import { BehaviorIdSchema, parseAugment, parseRole, parseSkill } from './schemas.js';
import type { Augment, Role, Skill } from './schemas.js';
import type { Behavior } from '../sim/behavior.js';

export type ContentRegistry = {
  registerBehavior(behavior: Behavior): void;
  loadRole(data: unknown): Role;
  loadSkill(data: unknown): Skill;
  loadAugment(data: unknown): Augment;
  getBehavior(id: string): Behavior;
  getRole(id: string): Role;
  getSkill(id: string): Skill;
  getAugment(id: string): Augment;
};

export function createContentRegistry(): ContentRegistry {
  const behaviors = new Map<string, Behavior>();
  const roles = new Map<string, Role>();
  const skills = new Map<string, Skill>();
  const augments = new Map<string, Augment>();

  function registerBehavior(behavior: Behavior): void {
    const id = BehaviorIdSchema.parse(behavior.id);
    if (behaviors.has(id)) {
      throw new Error(`Duplicate behavior id: ${id}`);
    }
    behaviors.set(id, behavior);
  }

  function loadRole(data: unknown): Role {
    const role = parseRole(data);
    if (roles.has(role.id)) {
      throw new Error(`Duplicate role id: ${role.id}`);
    }
    roles.set(role.id, role);
    return role;
  }

  function loadSkill(data: unknown): Skill {
    const skill = parseSkill(data);
    if (skills.has(skill.id)) {
      throw new Error(`Duplicate skill id: ${skill.id}`);
    }
    skills.set(skill.id, skill);
    return skill;
  }

  function loadAugment(data: unknown): Augment {
    const augment = parseAugment(data);
    if (augments.has(augment.id)) {
      throw new Error(`Duplicate augment id: ${augment.id}`);
    }
    augments.set(augment.id, augment);
    return augment;
  }

  function getBehavior(id: string): Behavior {
    const behavior = behaviors.get(id);
    if (!behavior) {
      throw new Error(`Unknown behavior id: ${id}`);
    }
    return behavior;
  }

  function getRole(id: string): Role {
    const role = roles.get(id);
    if (!role) {
      throw new Error(`Unknown role id: ${id}`);
    }
    return role;
  }

  function getSkill(id: string): Skill {
    const skill = skills.get(id);
    if (!skill) {
      throw new Error(`Unknown skill id: ${id}`);
    }
    return skill;
  }

  function getAugment(id: string): Augment {
    const augment = augments.get(id);
    if (!augment) {
      throw new Error(`Unknown augment id: ${id}`);
    }
    return augment;
  }

  return {
    registerBehavior,
    loadRole,
    loadSkill,
    loadAugment,
    getBehavior,
    getRole,
    getSkill,
    getAugment,
  };
}
