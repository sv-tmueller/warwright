import { describe, expect, it } from 'vitest';
import type { Behavior } from './behavior.js';
import { runMatchWithBehaviors } from './match-with-behaviors.js';

const VERSION = 1;
const SEED = 42;

// A trivial injected Behavior: attack the lowest-hp enemy if in range,
// otherwise move toward it. Not registered in the seed registry -- it only
// exists via the extraBehaviors param, proving the seam works end to end.
const trivialAttacker: Behavior = {
  id: 'trivial-attacker',
  decide: (self, world) => {
    const enemies = world.enemiesOf(self);
    const target = enemies[0];
    if (!target) return { kind: 'idle' };
    const dx = self.pos.x - target.pos.x;
    const dy = self.pos.y - target.pos.y;
    const d2 = dx * dx + dy * dy;
    return d2 <= self.attackRangeSquared
      ? { kind: 'attack', targetId: target.id }
      : { kind: 'move-toward', targetId: target.id };
  },
};

const buildA = {
  name: 'Injected A',
  units: [
    {
      roleId: 'reaver',
      skillIds: [],
      behaviorId: 'trivial-attacker',
      position: { x: 0, y: 0 },
    },
  ],
};

const buildB = {
  name: 'Elimination B',
  units: [
    {
      roleId: 'mender',
      skillIds: [],
      behaviorId: 'aggro-lowest-hp',
      position: { x: 10, y: 0 },
    },
  ],
};

describe('runMatchWithBehaviors', () => {
  it('runs a match to a deterministic winner using an injected Behavior not in the seed registry', () => {
    const result = runMatchWithBehaviors(
      { version: VERSION, seed: SEED, buildA, buildB },
      [trivialAttacker],
    );

    expect(result.winner).toBe('A');
    expect(result.version).toBe(VERSION);
    expect(result.seed).toBe(SEED);
  });

  it('throws loud when an injected Behavior id collides with a seed id', () => {
    const colliding: Behavior = { id: 'aggro-lowest-hp', decide: () => ({ kind: 'idle' }) };

    expect(() =>
      runMatchWithBehaviors({ version: VERSION, seed: SEED, buildA, buildB }, [colliding]),
    ).toThrow('Duplicate behavior id: aggro-lowest-hp');
  });

  it('is bit-identical to runMatch when extraBehaviors is empty', async () => {
    const { runMatch } = await import('./match.js');

    const eliminationBuildA = {
      name: 'Elimination A',
      units: [
        { roleId: 'reaver', skillIds: [], behaviorId: 'aggro-lowest-hp', position: { x: 0, y: 0 } },
      ],
    };

    const viaRunMatch = runMatch({
      version: VERSION,
      seed: SEED,
      buildA: eliminationBuildA,
      buildB,
    });
    const viaExtras = runMatchWithBehaviors(
      { version: VERSION, seed: SEED, buildA: eliminationBuildA, buildB },
      [],
    );

    expect(viaExtras).toEqual(viaRunMatch);
  });
});
