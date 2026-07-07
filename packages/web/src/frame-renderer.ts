import type { DrawContext } from './art/context.js';
import { drawBar, drawRoleSilhouette, drawSkillIcon, drawStatusIndicator } from './art/index.js';
import type { FrameState, FrameUnit, Position, TickEffect } from './frame-state.js';

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
const CAST_ICON_SIZE = 10;
const CAST_ICON_OFFSET_Y = -44;
const ATTACK_FLASH_COLOR = '#ffcc00';
const ATTACK_FLASH_WIDTH = 2;
const DAMAGE_MARKER_RADIUS = 10;
const DAMAGE_MARKER_COLOR = '#ff3b30';
const DAMAGE_MARKER_WIDTH = 2;

/**
 * Draws a FrameState onto a DrawContext: a background fill, then for each
 * living unit (walked in ascending id order, mirroring the determinism
 * contract's processing order) a role silhouette, an hp bar, and one status
 * indicator per active status, and finally `tickEffects` (attack/cast/damage
 * events at exactly this tick) as transient overlays, in log order: casts via
 * `drawSkillIcon` near the caster, attack/damage via inline `DrawContext`
 * primitives (a line flash and a ring marker respectively - see the sub-plan
 * on issue #77 for why these two stay inline instead of joining the art
 * module). Pure: no state, no randomness, no import from @warwright/core.
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

  drawTickEffects(ctx, frame, transform);
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

// Looked up by id regardless of `dead`: a unit can die on the same tick as
// the attack/damage event that killed it, and the overlay still needs a
// position for that unit.
function drawTickEffects(ctx: DrawContext, frame: FrameState, transform: Transform): void {
  const unitsById = new Map(frame.units.map((unit) => [unit.id, unit]));

  for (const effect of frame.tickEffects) {
    drawTickEffect(ctx, effect, unitsById, transform);
  }
}

function drawTickEffect(
  ctx: DrawContext,
  effect: TickEffect,
  unitsById: ReadonlyMap<number, FrameUnit>,
  transform: Transform,
): void {
  switch (effect.kind) {
    case 'cast': {
      const caster = unitsById.get(effect.unitId);
      if (!caster) return;
      const { x, y } = transform.toCanvas(caster.pos);
      drawSkillIcon(ctx, {
        skillId: effect.skillId,
        x,
        y: y + CAST_ICON_OFFSET_Y,
        size: CAST_ICON_SIZE,
      });
      return;
    }
    case 'attack': {
      const attacker = unitsById.get(effect.unitId);
      const target = unitsById.get(effect.targetId);
      if (!attacker || !target) return;
      const from = transform.toCanvas(attacker.pos);
      const to = transform.toCanvas(target.pos);
      ctx.save();
      ctx.strokeStyle = ATTACK_FLASH_COLOR;
      ctx.lineWidth = ATTACK_FLASH_WIDTH;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    case 'damage': {
      const target = unitsById.get(effect.targetId);
      if (!target) return;
      const { x, y } = transform.toCanvas(target.pos);
      ctx.save();
      ctx.strokeStyle = DAMAGE_MARKER_COLOR;
      ctx.lineWidth = DAMAGE_MARKER_WIDTH;
      ctx.beginPath();
      ctx.arc(x, y, DAMAGE_MARKER_RADIUS, 0, Math.PI * 2, false);
      ctx.stroke();
      ctx.restore();
      return;
    }
  }
}
