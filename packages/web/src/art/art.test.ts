import { describe, expect, it } from 'vitest';
import { RecordingContext } from './recording-context.js';
import { drawBar, drawRoleSilhouette, drawSkillIcon, drawStatusIndicator } from './index.js';

// Fixture ids mirror packages/core/src/content/data/{roles,skills}.ts and
// packages/core/src/sim/vocab.ts, but are literal here on purpose: the art
// module never imports core (see the sub-plan on issue #46).
const ROLE_IDS = ['vanguard', 'warden', 'reaver', 'mender'] as const;
const SKILL_IDS = [
  'shield-bash',
  'guardian-ward',
  'cleave',
  'frost-bolt',
  'venom-shot',
  'mending-touch',
] as const;
const STATUS_KINDS = ['slow', 'shield', 'dot'] as const;

function commandsFor(draw: (ctx: RecordingContext) => void): readonly unknown[] {
  const ctx = new RecordingContext();
  draw(ctx);
  return ctx.commands;
}

function assertAllDistinct(streams: readonly unknown[]): void {
  const serialized = streams.map((stream) => JSON.stringify(stream));
  expect(new Set(serialized).size).toBe(serialized.length);
}

describe('drawRoleSilhouette', () => {
  it('is deterministic: identical params yield identical command streams', () => {
    const params = { roleId: 'vanguard', hp: 120, maxHp: 200, x: 10, y: 20 };
    const first = commandsFor((ctx) => drawRoleSilhouette(ctx, params));
    const second = commandsFor((ctx) => drawRoleSilhouette(ctx, params));
    expect(first).toEqual(second);
  });

  it('yields a distinct command stream for each role id', () => {
    const streams = ROLE_IDS.map((roleId) =>
      commandsFor((ctx) => drawRoleSilhouette(ctx, { roleId, hp: 100, maxHp: 100, x: 0, y: 0 })),
    );
    assertAllDistinct(streams);
  });
});

describe('drawSkillIcon', () => {
  it('is deterministic: identical params yield identical command streams', () => {
    const params = { skillId: 'cleave', x: 5, y: 5, size: 12 };
    const first = commandsFor((ctx) => drawSkillIcon(ctx, params));
    const second = commandsFor((ctx) => drawSkillIcon(ctx, params));
    expect(first).toEqual(second);
  });

  it('yields a distinct command stream for each skill id', () => {
    const streams = SKILL_IDS.map((skillId) =>
      commandsFor((ctx) => drawSkillIcon(ctx, { skillId, x: 0, y: 0, size: 10 })),
    );
    assertAllDistinct(streams);
  });
});

describe('drawBar', () => {
  const base = { x: 0, y: 0, width: 100, height: 8, fillColor: '#0f0' };

  it('is deterministic: identical params yield identical command streams', () => {
    const params = { ...base, current: 40, max: 100 };
    const first = commandsFor((ctx) => drawBar(ctx, params));
    const second = commandsFor((ctx) => drawBar(ctx, params));
    expect(first).toEqual(second);
  });

  it('yields a distinct command stream for different fill ratios', () => {
    const streams = [
      commandsFor((ctx) => drawBar(ctx, { ...base, current: 100, max: 100 })),
      commandsFor((ctx) => drawBar(ctx, { ...base, current: 50, max: 100 })),
      commandsFor((ctx) => drawBar(ctx, { ...base, current: 0, max: 100 })),
    ];
    assertAllDistinct(streams);
  });
});

describe('drawStatusIndicator', () => {
  it('is deterministic: identical params yield identical command streams', () => {
    const params = { kind: 'slow', x: 3, y: 4, size: 6 };
    const first = commandsFor((ctx) => drawStatusIndicator(ctx, params));
    const second = commandsFor((ctx) => drawStatusIndicator(ctx, params));
    expect(first).toEqual(second);
  });

  it('yields a distinct command stream for each status kind', () => {
    const streams = STATUS_KINDS.map((kind) =>
      commandsFor((ctx) => drawStatusIndicator(ctx, { kind, x: 0, y: 0, size: 6 })),
    );
    assertAllDistinct(streams);
  });
});
