import type { DrawContext } from './context.js';
import { hashString } from './hash.js';

const ROLE_SHAPES = ['circle', 'square', 'triangle', 'diamond'] as const;
type RoleShape = (typeof ROLE_SHAPES)[number];

const MIN_ROLE_RADIUS = 8;
const ROLE_RADIUS_RANGE = 24;

export interface DrawRoleSilhouetteParams {
  readonly roleId: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Draws a role's on-arena token: shape and color are derived from the role
 * id, size from the hp/maxHp ratio. CLAUDE.md: "Units encode Role by color
 * and shape, hp by size."
 */
export function drawRoleSilhouette(ctx: DrawContext, params: DrawRoleSilhouetteParams): void {
  const { roleId, hp, maxHp, x, y } = params;
  const hash = hashString(roleId);
  const shape = ROLE_SHAPES[hash % ROLE_SHAPES.length] as RoleShape;
  const hue = hash % 360;
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const radius = MIN_ROLE_RADIUS + ratio * ROLE_RADIUS_RANGE;

  ctx.save();
  ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
  tracePath(ctx, shape, x, y, radius);
  ctx.fill();
  ctx.restore();
}

function tracePath(ctx: DrawContext, shape: RoleShape, x: number, y: number, radius: number): void {
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(x, y, radius, 0, Math.PI * 2, false);
      return;
    case 'square':
      ctx.moveTo(x - radius, y - radius);
      ctx.lineTo(x + radius, y - radius);
      ctx.lineTo(x + radius, y + radius);
      ctx.lineTo(x - radius, y + radius);
      ctx.closePath();
      return;
    case 'triangle':
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y + radius);
      ctx.lineTo(x - radius, y + radius);
      ctx.closePath();
      return;
    case 'diamond':
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
      return;
  }
}
