import { describe, expect, it } from 'vitest';
import { RecordingContext } from '../art/recording-context.js';
import { drawRoleSilhouette } from '../art/index.js';
import type { AssetProvider } from './provider.js';
import { proceduralProvider, resolveAssetProvider } from './provider.js';

describe('resolveAssetProvider', () => {
  it('returns proceduralProvider when called with no override', () => {
    expect(resolveAssetProvider()).toBe(proceduralProvider);
  });

  it('returns the given override and its methods are the ones invoked', () => {
    const calls: string[] = [];
    const stub: AssetProvider = {
      drawRoleSilhouette: () => calls.push('drawRoleSilhouette'),
      drawSkillIcon: () => calls.push('drawSkillIcon'),
      drawBar: () => calls.push('drawBar'),
      drawStatusIndicator: () => calls.push('drawStatusIndicator'),
    };

    const resolved = resolveAssetProvider(stub);
    expect(resolved).toBe(stub);

    const ctx = new RecordingContext();
    resolved.drawRoleSilhouette(ctx, { roleId: 'vanguard', hp: 100, maxHp: 100, x: 0, y: 0 });
    expect(calls).toEqual(['drawRoleSilhouette']);
    expect(ctx.commands).toEqual([]);
  });

  it('proceduralProvider.drawRoleSilhouette matches the direct art module call', () => {
    const params = { roleId: 'vanguard', hp: 120, maxHp: 200, x: 10, y: 20 };

    const viaProvider = new RecordingContext();
    proceduralProvider.drawRoleSilhouette(viaProvider, params);

    const direct = new RecordingContext();
    drawRoleSilhouette(direct, params);

    expect(viaProvider.commands).toEqual(direct.commands);
  });
});
