import type { DrawContext } from './context.js';

/**
 * A single recorded interaction with a RecordingContext: either a method
 * call (with its arguments) or a style property set.
 */
export type RecordedCommand =
  | { readonly kind: 'call'; readonly method: string; readonly args: readonly unknown[] }
  | { readonly kind: 'set'; readonly property: string; readonly value: unknown };

/**
 * Test-support recording mock for DrawContext. Appends every method call and
 * style property set to an ordered command list, so tests can assert
 * determinism (identical inputs produce an identical command stream) and
 * distinctness (different inputs produce a different command stream)
 * without a real canvas. Not a `*.test.ts` file, so vitest does not treat it
 * as a suite.
 */
export class RecordingContext implements DrawContext {
  readonly commands: RecordedCommand[] = [];

  private recordCall(method: string, args: readonly unknown[]): void {
    this.commands.push({ kind: 'call', method, args });
  }

  private recordSet(property: string, value: unknown): void {
    this.commands.push({ kind: 'set', property, value });
  }

  fillRect = (x: number, y: number, w: number, h: number): void => {
    this.recordCall('fillRect', [x, y, w, h]);
  };

  beginPath = (): void => {
    this.recordCall('beginPath', []);
  };

  moveTo = (x: number, y: number): void => {
    this.recordCall('moveTo', [x, y]);
  };

  lineTo = (x: number, y: number): void => {
    this.recordCall('lineTo', [x, y]);
  };

  closePath = (): void => {
    this.recordCall('closePath', []);
  };

  arc = (
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void => {
    this.recordCall('arc', [x, y, radius, startAngle, endAngle, counterclockwise]);
  };

  fill = (...args: readonly unknown[]): void => {
    this.recordCall('fill', args);
  };

  stroke = (...args: readonly unknown[]): void => {
    this.recordCall('stroke', args);
  };

  save = (): void => {
    this.recordCall('save', []);
  };

  restore = (): void => {
    this.recordCall('restore', []);
  };

  #fillStyle: string | CanvasGradient | CanvasPattern = '';

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.#fillStyle;
  }

  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.#fillStyle = value;
    this.recordSet('fillStyle', value);
  }

  #strokeStyle: string | CanvasGradient | CanvasPattern = '';

  get strokeStyle(): string | CanvasGradient | CanvasPattern {
    return this.#strokeStyle;
  }

  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    this.#strokeStyle = value;
    this.recordSet('strokeStyle', value);
  }

  #lineWidth = 1;

  get lineWidth(): number {
    return this.#lineWidth;
  }

  set lineWidth(value: number) {
    this.#lineWidth = value;
    this.recordSet('lineWidth', value);
  }
}
