/**
 * The subset of CanvasRenderingContext2D that the art module needs. Narrowed
 * so a lightweight recording mock (see recording-context.ts) can satisfy the
 * same interface as a real 2D canvas context in tests, without implementing
 * the full ~200-member CanvasRenderingContext2D surface.
 */
export type DrawContext = Pick<
  CanvasRenderingContext2D,
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'save'
  | 'restore'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
>;
