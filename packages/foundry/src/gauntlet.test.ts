import { describe, expect, it } from 'vitest';
import type { Behavior, UnitView, WorldView } from '@warwright/core';
import { parseSubmissionManifest } from './manifest.js';
import { GAUNTLET_SEEDS, runGauntlet } from './gauntlet.js';

const aggroManifest = parseSubmissionManifest('sample-aggro', {
  id: 'sample-aggro',
  author: 'foundry-fixtures',
  entry: 'behavior.ts',
  build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
  baseline: 'aggro-lowest-hp',
  shape: 'general',
});

function squaredDistance(a: UnitView['pos'], b: UnitView['pos']): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

const aggroBehavior: Behavior = {
  id: 'sample-aggro',
  decide: (self: UnitView, world: WorldView) => {
    const enemies = world.enemiesOf(self);
    let target: UnitView | undefined;
    for (const enemy of enemies) {
      if (target === undefined || enemy.hp < target.hp) target = enemy;
    }
    if (target === undefined) return { kind: 'idle' };
    return squaredDistance(self.pos, target.pos) <= self.attackRangeSquared
      ? { kind: 'attack', targetId: target.id }
      : { kind: 'move-toward', targetId: target.id };
  },
};

const idleBehavior: Behavior = {
  id: 'sample-aggro',
  decide: () => ({ kind: 'idle' }),
};

describe('GAUNTLET_SEEDS', () => {
  it('is a fixed, committed set of 25 seeds', () => {
    expect(GAUNTLET_SEEDS).toHaveLength(25);
    expect(GAUNTLET_SEEDS).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
});

describe('runGauntlet', () => {
  it('runs the submission Behavior over every seed and reports a win rate', () => {
    const result = runGauntlet(aggroManifest, aggroBehavior);

    expect(result.submissionId).toBe('sample-aggro');
    expect(result.total).toBe(GAUNTLET_SEEDS.length);
    expect(result.wins).toBeGreaterThan(0);
    expect(result.winRate).toBe(result.wins / result.total);
    expect(result.matches).toHaveLength(GAUNTLET_SEEDS.length);
  });

  it('scores an always-idle Behavior at (or near) a 0 win rate', () => {
    const result = runGauntlet(aggroManifest, idleBehavior);

    expect(result.wins).toBe(0);
    expect(result.winRate).toBe(0);
  });

  it('is reproducible: running the gauntlet twice yields identical win rates and identical per-match hashes', () => {
    const first = runGauntlet(aggroManifest, aggroBehavior);
    const second = runGauntlet(aggroManifest, aggroBehavior);

    expect(second.winRate).toBe(first.winRate);
    expect(second.wins).toBe(first.wins);
    expect(second.matches.map((m) => m.hash)).toEqual(first.matches.map((m) => m.hash));
  });

  it('surfaces a clear stage-3 message when a policy Behavior is run against a mismatched roster shape', () => {
    const generalPolicyManifest = parseSubmissionManifest('mismatched-policy', {
      id: 'mismatched-policy',
      author: 'foundry-fixtures',
      entry: 'behavior.ts',
      build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
      baseline: 'aggro-lowest-hp',
      // Deliberately wrong: policy-smoke-v1 was trained on a 0-ally/1-enemy
      // roster (the '1v1' baseline), not the two-enemy 'general' baseline.
      shape: 'general',
    });

    // A stand-in policy-shaped Behavior: throws exactly like
    // policy-smoke-v1.ts does on an observation-length mismatch, without
    // depending on the real trained weights.
    const policyLikeBehavior: Behavior = {
      id: 'mismatched-policy',
      decide: (self: UnitView, world: WorldView) => {
        const observation = world.observationOf(self);
        if (observation.length !== 17) {
          throw new Error(
            `policy-smoke-v1: observation length ${observation.length} does not match the trained obsDim 17. ` +
              'This Behavior was exported for a fixed roster shape (0 allies, 1 enemy).',
          );
        }
        return { kind: 'idle' };
      },
    };

    expect(() => runGauntlet(generalPolicyManifest, policyLikeBehavior)).toThrow(
      /Stage 3 \(gauntlet\).*roster shape/is,
    );
  });
});
