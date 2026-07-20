// Sanity check for content/behaviors/policy/tanh.ts's detTanh against
// Math.tanh. Deliberately lives OUTSIDE the determinism-scanned dirs
// (sim/** and content/behaviors/**, see determinism-scan.test.ts and
// eslint.config.js's sim/ override) because it references the forbidden
// Math.tanh directly -- this file exists only to validate the deterministic
// approximation during development/CI, never runs inside a match.
import { describe, expect, it } from 'vitest';
import { CLAMP_THRESHOLD, detTanh } from './content/behaviors/policy/tanh.js';

// Comfortably above detTanh's actual error against Math.tanh (~1e-15, double
// -precision noise) and comfortably below the parity fixture's 0.01 near-tie
// margin filter -- see tanh.ts's docstring for how TERMS/CLAMP_THRESHOLD
// were chosen.
const MAX_ALLOWED_ERROR = 1e-9;

describe('detTanh vs Math.tanh (reference sanity check)', () => {
  it('matches Math.tanh to within MAX_ALLOWED_ERROR across a fine grid up to CLAMP_THRESHOLD', () => {
    let maxError = 0;
    for (let x = -CLAMP_THRESHOLD; x <= CLAMP_THRESHOLD; x += 0.01) {
      const error = Math.abs(detTanh(x) - Math.tanh(x));
      if (error > maxError) maxError = error;
    }
    expect(maxError).toBeLessThan(MAX_ALLOWED_ERROR);
  });

  it('matches Math.tanh at a handful of well-known values', () => {
    for (const x of [0, 0.5, 1, 2, 3.7, 5, 9, 12, 19.9]) {
      expect(detTanh(x)).toBeCloseTo(Math.tanh(x), 9);
      expect(detTanh(-x)).toBeCloseTo(Math.tanh(-x), 9);
    }
  });

  it('agrees with Math.tanh that values beyond the clamp threshold round to exactly 1', () => {
    expect(Math.tanh(CLAMP_THRESHOLD)).toBe(1);
    expect(detTanh(CLAMP_THRESHOLD + 5)).toBe(1);
  });
});
