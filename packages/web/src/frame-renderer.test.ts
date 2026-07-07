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

function callCount(commands: readonly unknown[], method: string): number {
  return commands.filter(
    (command) =>
      typeof command === 'object' &&
      command !== null &&
      'kind' in command &&
      command.kind === 'call' &&
      'method' in command &&
      command.method === method,
  ).length;
}

describe('drawFrame: tickEffects overlays', () => {
  it('draws a cast overlay via drawSkillIcon (a fill call) near the caster', () => {
    const units = [makeUnit({ id: 0 }), makeUnit({ id: 1 })];
    const withoutCast = makeFrame({ units });
    const withCast = makeFrame({
      units,
      tickEffects: [{ kind: 'cast', tick: 0, unitId: 0, skillId: 'frost-bolt', targetId: 1 }],
    });

    expect(callCount(drawAndRecord(withCast), 'fill')).toBe(
      callCount(drawAndRecord(withoutCast), 'fill') + 1,
    );
  });

  it('cast overlays are deterministic and vary with skillId', () => {
    const units = [makeUnit({ id: 0 })];
    const frostBolt = makeFrame({
      units,
      tickEffects: [{ kind: 'cast', tick: 0, unitId: 0, skillId: 'frost-bolt', targetId: 0 }],
    });
    const venomShot = makeFrame({
      units,
      tickEffects: [{ kind: 'cast', tick: 0, unitId: 0, skillId: 'venom-shot', targetId: 0 }],
    });

    expect(drawAndRecord(frostBolt)).toEqual(drawAndRecord(frostBolt));
    expect(drawAndRecord(frostBolt)).not.toEqual(drawAndRecord(venomShot));
  });

  it('draws an inline line-flash overlay for an attack tick effect', () => {
    const units = [makeUnit({ id: 0 }), makeUnit({ id: 1 })];
    const withoutAttack = makeFrame({ units });
    const withAttack = makeFrame({
      units,
      tickEffects: [{ kind: 'attack', tick: 0, unitId: 0, targetId: 1 }],
    });

    expect(callCount(drawAndRecord(withAttack), 'stroke')).toBe(
      callCount(drawAndRecord(withoutAttack), 'stroke') + 1,
    );
    expect(callCount(drawAndRecord(withAttack), 'lineTo')).toBe(
      callCount(drawAndRecord(withoutAttack), 'lineTo') + 1,
    );
  });

  it('draws an inline ring marker overlay for a damage tick effect', () => {
    const units = [makeUnit({ id: 0 })];
    const withoutDamage = makeFrame({ units });
    const withDamage = makeFrame({
      units,
      tickEffects: [
        { kind: 'damage', tick: 0, sourceId: null, targetId: 0, amount: 10, absorbed: 0, hpAfter: 90 },
      ],
    });

    expect(callCount(drawAndRecord(withDamage), 'arc')).toBe(
      callCount(drawAndRecord(withoutDamage), 'arc') + 1,
    );
  });

  it('draws tickEffects for units regardless of dead flag (a unit can die on the same tick)', () => {
    const units = [makeUnit({ id: 0 }), makeUnit({ id: 1, dead: true })];
    const withoutDamage = makeFrame({ units });
    const withDamage = makeFrame({
      units,
      tickEffects: [
        { kind: 'damage', tick: 0, sourceId: 0, targetId: 1, amount: 90, absorbed: 0, hpAfter: 0 },
      ],
    });

    expect(callCount(drawAndRecord(withDamage), 'arc')).toBe(
      callCount(drawAndRecord(withoutDamage), 'arc') + 1,
    );
  });

  it('is a no-op when tickEffects is empty', () => {
    const frame = makeFrame({ units: [makeUnit({ id: 0 })], tickEffects: [] });
    expect(drawAndRecord(frame)).toEqual(drawAndRecord(makeFrame({ units: [makeUnit({ id: 0 })] })));
  });
});
