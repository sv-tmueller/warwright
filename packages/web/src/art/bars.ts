import type { DrawContext } from './context.js';
import { hashString } from './hash.js';

const DEFAULT_BAR_BACKGROUND = '#202020';

export interface DrawBarParams {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly current: number;
  readonly max: number;
  readonly fillColor: string;
  readonly backgroundColor?: string;
}

/** Draws a generic hp/resource bar: fill width is the current/max ratio. */
export function drawBar(ctx: DrawContext, params: DrawBarParams): void {
  const {
    x,
    y,
    width,
    height,
    current,
    max,
    fillColor,
    backgroundColor = DEFAULT_BAR_BACKGROUND,
  } = params;
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;

  ctx.save();
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = fillColor;
  ctx.fillRect(x, y, width * ratio, height);
  ctx.restore();
}

const MIN_STATUS_RING_WIDTH = 1;
const STATUS_RING_WIDTH_RANGE = 3;

export interface DrawStatusIndicatorParams {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** Draws a status badge: fill, stroke, and ring width are derived from the status kind string. */
export function drawStatusIndicator(ctx: DrawContext, params: DrawStatusIndicatorParams): void {
  const { kind, x, y, size } = params;
  const hash = hashString(kind);
  const hue = hash % 360;
  const ringWidth = MIN_STATUS_RING_WIDTH + (hash % STATUS_RING_WIDTH_RANGE);

  ctx.save();
  ctx.fillStyle = `hsl(${hue}, 60%, 50%)`;
  ctx.strokeStyle = `hsl(${hue}, 60%, 30%)`;
  ctx.lineWidth = ringWidth;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2, false);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
