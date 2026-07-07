import type { DrawContext } from './art/context.js';
import { drawBar, drawRoleSilhouette, drawStatusIndicator } from './art/index.js';
import type { FrameState, FrameUnit, Position } from './frame-state.js';

/**
 * Explicit world->canvas transform, supplied by the caller. Arena bounds
 * are not part of core's public API (see the sub-plan on issue #48), so
 * this module has no notion of them: it just consumes whatever mapping and
 * canvas size the caller provides.
 */
export type CanvasPosition = {
  readonly x: number;
  readonly y: number;
};

export type Transform = {
  readonly width: number;
  readonly height: number;
  toCanvas(pos: Position): CanvasPosition;
};

const BACKGROUND_COLOR = '#101018';
const HP_BAR_WIDTH = 40;
const HP_BAR_HEIGHT = 6;
const HP_BAR_OFFSET_Y = 20;
const HP_BAR_FILL_COLOR = '#2ecc71';
const STATUS_INDICATOR_RADIUS = 5;
const STATUS_INDICATOR_SPACING = 14;
const STATUS_INDICATOR_OFFSET_Y = 32;

/**
 * Draws a FrameState onto a DrawContext: a background fill, then for each
 * living unit (walked in ascending id order, mirroring the determinism
 * contract's processing order) a role silhouette, an hp bar, and one status
 * indicator per active status. Pure: no state, no randomness, no import
 * from @warwright/core.
 *
 * `tickEffects` is not drawn here. The sub-plan's own verification step
 * only requires a silhouette + hp bar + status indicators, and decision 3
 * defers ability/cast visuals (drawSkillIcon) to a later issue; the data
 * stays on FrameState for that follow-up to consume.
 */
export function drawFrame(ctx: DrawContext, frame: FrameState, transform: Transform): void {
  ctx.save();
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, transform.width, transform.height);
  ctx.restore();

  const livingUnits = frame.units.filter((unit) => !unit.dead).sort((a, b) => a.id - b.id);
  for (const unit of livingUnits) {
    drawUnit(ctx, unit, transform);
  }
}

function drawUnit(ctx: DrawContext, unit: FrameUnit, transform: Transform): void {
  const { x, y } = transform.toCanvas(unit.pos);

  drawRoleSilhouette(ctx, { roleId: unit.roleId, hp: unit.hp, maxHp: unit.maxHp, x, y });

  drawBar(ctx, {
    x: x - HP_BAR_WIDTH / 2,
    y: y - HP_BAR_OFFSET_Y,
    width: HP_BAR_WIDTH,
    height: HP_BAR_HEIGHT,
    current: unit.hp,
    max: unit.maxHp,
    fillColor: HP_BAR_FILL_COLOR,
  });

  const statusKinds = Object.keys(unit.statuses).sort();
  statusKinds.forEach((kind, index) => {
    const spread = (statusKinds.length - 1) * STATUS_INDICATOR_SPACING;
    drawStatusIndicator(ctx, {
      kind,
      x: x - spread / 2 + index * STATUS_INDICATOR_SPACING,
      y: y + STATUS_INDICATOR_OFFSET_Y,
      size: STATUS_INDICATOR_RADIUS,
    });
  });
}
