import { BehaviorIdSchema, parseRole, parseSkill } from './schemas.js';
import type { Role, Skill } from './schemas.js';
import type { Behavior } from '../sim/behavior.js';

export type ContentRegistry = {
  registerBehavior(behavior: Behavior): void;
  loadRole(data: unknown): Role;
  loadSkill(data: unknown): Skill;
  getBehavior(id: string): Behavior;
  getRole(id: string): Role;
  getSkill(id: string): Skill;
};

export function createContentRegistry(): ContentRegistry {
  const behaviors = new Map<string, Behavior>();
  const roles = new Map<string, Role>();
  const skills = new Map<string, Skill>();

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

  return { registerBehavior, loadRole, loadSkill, getBehavior, getRole, getSkill };
}
