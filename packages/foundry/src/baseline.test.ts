import { describe, expect, it } from 'vitest';
import { parseSubmissionManifest } from './manifest.js';
import { GATE_GENERAL_BASELINE_BEHAVIOR_ID, baselineWarbandFor } from './baseline.js';

function manifestWith(id: string, shape: 'general' | '1v1') {
  return parseSubmissionManifest(id, {
    id,
    author: 'foundry-fixtures',
    entry: 'behavior.ts',
    build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
    shape,
  });
}

const generalManifest = manifestWith('sample-aggro', 'general');
const oneVOneManifest = manifestWith('baseline-1v1-check', '1v1');

describe('GATE_GENERAL_BASELINE_BEHAVIOR_ID', () => {
  it('is a defined, non-empty, gate-chosen Behavior id', () => {
    expect(typeof GATE_GENERAL_BASELINE_BEHAVIOR_ID).toBe('string');
    expect(GATE_GENERAL_BASELINE_BEHAVIOR_ID).toBe('aggro-lowest-hp');
  });
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
        augmentIds: [],
      },
    ]);
  });

  it("for shape 'general', returns a two-unit warband running the GATE-pinned baseline Behavior id", () => {
    const warband = baselineWarbandFor(generalManifest);

    expect(warband.units).toHaveLength(2);
    for (const unit of warband.units) {
      expect(unit.behaviorId).toBe('aggro-lowest-hp');
      expect(unit.behaviorId).toBe(GATE_GENERAL_BASELINE_BEHAVIOR_ID);
    }
  });

  it("the 'general' roster's opponent Behavior is gate-pinned, not derived from any submission-supplied field -- two different submission ids/shapes still get the same opponent id", () => {
    const other = manifestWith('some-other-submission', 'general');

    const first = baselineWarbandFor(generalManifest);
    const second = baselineWarbandFor(other);

    expect(first.units.map((unit) => unit.behaviorId)).toEqual(
      second.units.map((unit) => unit.behaviorId),
    );
    expect(first.units.map((unit) => unit.behaviorId)).toEqual([
      GATE_GENERAL_BASELINE_BEHAVIOR_ID,
      GATE_GENERAL_BASELINE_BEHAVIOR_ID,
    ]);
  });

  it("is a pure function of the manifest -- calling it twice for the same shape returns equal warbands", () => {
    const first = baselineWarbandFor(generalManifest);
    const second = baselineWarbandFor(generalManifest);

    expect(first).toEqual(second);
  });
});
