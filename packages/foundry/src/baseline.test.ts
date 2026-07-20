import { describe, expect, it } from 'vitest';
import { parseSubmissionManifest } from './manifest.js';
import { baselineWarbandFor } from './baseline.js';

const generalManifest = parseSubmissionManifest('sample-aggro', {
  id: 'sample-aggro',
  author: 'foundry-fixtures',
  entry: 'behavior.ts',
  build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
  baseline: 'aggro-lowest-hp',
  shape: 'general',
});

const oneVOneManifest = parseSubmissionManifest('sample-policy', {
  id: 'sample-policy',
  author: 'foundry-fixtures',
  entry: 'behavior.ts',
  build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
  baseline: 'aggro-lowest-hp',
  shape: '1v1',
});

describe('baselineWarbandFor', () => {
  it("for shape '1v1', returns exactly builds/policy-1v1-b.json's warband", () => {
    const warband = baselineWarbandFor(oneVOneManifest);

    expect(warband.name).toBe('Policy Baseline');
    expect(warband.units).toEqual([
      {
        roleId: 'warden',
        skillIds: [],
        behaviorId: 'aggro-lowest-hp',
        position: { x: 15, y: 0 },
      },
    ]);
  });

  it("for shape 'general', returns a two-unit warband running the manifest's declared baseline id", () => {
    const warband = baselineWarbandFor(generalManifest);

    expect(warband.units).toHaveLength(2);
    for (const unit of warband.units) {
      expect(unit.behaviorId).toBe('aggro-lowest-hp');
    }
  });

  it("is a pure function of the manifest -- calling it twice for the same shape returns equal warbands", () => {
    const first = baselineWarbandFor(generalManifest);
    const second = baselineWarbandFor(generalManifest);

    expect(first).toEqual(second);
  });
});
