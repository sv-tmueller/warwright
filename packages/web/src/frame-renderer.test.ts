import { describe, expect, it } from 'vitest';
import { RecordingContext } from './art/recording-context.js';
import type { FrameState, FrameUnit } from './frame-state.js';
import { drawFrame, type Transform } from './frame-renderer.js';

const TRANSFORM: Transform = {
  width: 200,
  height: 200,
  toCanvas: (pos) => ({ x: pos.x, y: pos.y }),
};

function makeUnit(overrides: Partial<FrameUnit> = {}): FrameUnit {
  return {
    id: 0,
    team: 'A',
    roleId: 'vanguard',
    pos: { x: 10, y: 10 },
    hp: 100,
    maxHp: 100,
    dead: false,
    statuses: {},
    ...overrides,
  };
}

function makeFrame(overrides: Partial<FrameState> = {}): FrameState {
  return {
    tick: 0,
    version: 2,
    seed: 1,
    units: [],
    winner: null,
    tickEffects: [],
    ...overrides,
  };
}

function drawAndRecord(frame: FrameState, transform: Transform = TRANSFORM): readonly unknown[] {
  const ctx = new RecordingContext();
  drawFrame(ctx, frame, transform);
  return ctx.commands;
}

describe('drawFrame', () => {
  it('is deterministic: identical (frame, transform) yield identical command streams', () => {
    const frame = makeFrame({ units: [makeUnit()] });
    expect(drawAndRecord(frame)).toEqual(drawAndRecord(frame));
  });

  it('yields a distinct command stream for a distinct frame', () => {
    const frameA = makeFrame({ units: [makeUnit({ id: 0, hp: 100 })] });
    const frameB = makeFrame({ units: [makeUnit({ id: 0, hp: 40 })] });
    expect(drawAndRecord(frameA)).not.toEqual(drawAndRecord(frameB));
  });

  it('draws a role silhouette and hp bar for each living unit', () => {
    const frame = makeFrame({
      units: [makeUnit({ id: 0 }), makeUnit({ id: 1, roleId: 'reaver' })],
    });
    const commands = drawAndRecord(frame);
    const saveCalls = commands.filter(
      (command) =>
        typeof command === 'object' &&
        command !== null &&
        'kind' in command &&
        command.kind === 'call' &&
        'method' in command &&
        command.method === 'save',
    );
    const fillRectCalls = commands.filter(
      (command) =>
        typeof command === 'object' &&
        command !== null &&
        'kind' in command &&
        command.kind === 'call' &&
        'method' in command &&
        command.method === 'fillRect',
    );

    // Each of drawRoleSilhouette and drawBar wraps its drawing in one
    // save/restore pair (regardless of the role's hash-derived shape), plus
    // the frame's own background save/restore: 1 + 2 units * 2 draw calls.
    expect(saveCalls.length).toBe(1 + 2 * 2);
    // One fillRect pair (background + fill) per hp bar, plus the frame's
    // own background fill.
    expect(fillRectCalls.length).toBe(1 + 2 * 2);
  });

  it('skips dead units entirely', () => {
    const aliveOnly = makeFrame({ units: [makeUnit({ id: 0 })] });
    const withDead = makeFrame({
      units: [makeUnit({ id: 0 }), makeUnit({ id: 1, dead: true })],
    });
    expect(drawAndRecord(withDead)).toEqual(drawAndRecord(aliveOnly));
  });

  it('draws one status indicator per active status', () => {
    const noStatus = makeFrame({ units: [makeUnit({ id: 0, statuses: {} })] });
    const oneStatus = makeFrame({
      units: [makeUnit({ id: 0, statuses: { slow: { magnitude: 30, durationTicks: 40 } } })],
    });
    const twoStatuses = makeFrame({
      units: [
        makeUnit({
          id: 0,
          statuses: {
            slow: { magnitude: 30, durationTicks: 40 },
            shield: { magnitude: 10, durationTicks: 5 },
          },
        }),
      ],
    });

    const arcCount = (commands: readonly unknown[]): number =>
      commands.filter(
        (command) =>
          typeof command === 'object' &&
          command !== null &&
          'kind' in command &&
          command.kind === 'call' &&
          'method' in command &&
          command.method === 'arc',
      ).length;

    const baseArcs = arcCount(drawAndRecord(noStatus));
    expect(arcCount(drawAndRecord(oneStatus))).toBe(baseArcs + 1);
    expect(arcCount(drawAndRecord(twoStatuses))).toBe(baseArcs + 2);
  });

  it('walks units in ascending id order regardless of input order', () => {
    const ascending = makeFrame({
      units: [makeUnit({ id: 0, roleId: 'vanguard' }), makeUnit({ id: 1, roleId: 'reaver' })],
    });
    const descendingInput = makeFrame({
      units: [makeUnit({ id: 1, roleId: 'reaver' }), makeUnit({ id: 0, roleId: 'vanguard' })],
    });
    expect(drawAndRecord(descendingInput)).toEqual(drawAndRecord(ascending));
  });

  it('fills the background using the transform-provided canvas size', () => {
    const commands = drawAndRecord(makeFrame({ units: [] }));
    const firstFillRect = commands.find(
      (command) =>
        typeof command === 'object' &&
        command !== null &&
        'kind' in command &&
        command.kind === 'call' &&
        'method' in command &&
        command.method === 'fillRect',
    );
    expect(firstFillRect).toMatchObject({ args: [0, 0, TRANSFORM.width, TRANSFORM.height] });
  });
});
