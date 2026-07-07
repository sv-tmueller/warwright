import type { DrawContext } from './context.js';
import { hashString } from './hash.js';

const MIN_ICON_SIDES = 3;
const ICON_SIDES_RANGE = 6;
const FULL_TURN = Math.PI * 2;

export interface DrawSkillIconParams {
  readonly skillId: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/**
 * Draws an ability icon: a regular polygon whose side count, rotation, and
 * color are all derived from the skill id. CLAUDE.md: "Ability icons are
 * deterministic from the skill id."
 */
export function drawSkillIcon(ctx: DrawContext, params: DrawSkillIconParams): void {
  const { skillId, x, y, size } = params;
  const hash = hashString(skillId);
  const sides = MIN_ICON_SIDES + (hash % ICON_SIDES_RANGE);
  const hue = (hash >>> 8) % 360;
  const rotation = ((hash % 1000) / 1000) * FULL_TURN;

  ctx.save();
  ctx.fillStyle = `hsl(${hue}, 65%, 55%)`;
  ctx.beginPath();
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i / sides) * FULL_TURN;
    const px = x + Math.cos(angle) * size;
    const py = y + Math.sin(angle) * size;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
