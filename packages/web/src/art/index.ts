/**
 * Public draw API for Warwright's procedural art module.
 *
 * Every function here is a pure draw call: given a DrawContext (a narrow
 * subset of CanvasRenderingContext2D, see context.ts) and a params object,
 * it issues a deterministic sequence of canvas commands derived from its
 * inputs. There is no hidden state, no randomness, and no dependency on
 * @warwright/core: role/skill ids and status kinds are consumed as plain
 * strings, hp/current/max as plain numbers (see the sub-plan on issue #46).
 *
 * - drawRoleSilhouette: a role's on-arena token (shape + color from the
 *   role id, size from hp/maxHp).
 * - drawSkillIcon: an ability icon (geometry + color from the skill id).
 * - drawBar: a generic hp/resource bar (fill ratio from current/max).
 * - drawStatusIndicator: a status badge (color + stroke from the status
 *   kind string).
 */
export type { DrawContext } from './context.js';
export type { DrawRoleSilhouetteParams } from './roles.js';
export { drawRoleSilhouette } from './roles.js';
export type { DrawSkillIconParams } from './icons.js';
export { drawSkillIcon } from './icons.js';
export type { DrawBarParams, DrawStatusIndicatorParams } from './bars.js';
export { drawBar, drawStatusIndicator } from './bars.js';
