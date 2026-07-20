// Property tests only -- no reference to the platform's built-in
// (ECMA-approximate) trig tanh here: this file lives under the
// determinism-scanned content/behaviors/** dir, which forbids that token
// even in comments (see determinism-scan.test.ts's FORBIDDEN_MATH regex).
// See packages/core/src/policy-tanh-reference.test.ts for the out-of-scan
// sanity check against that platform function.
import { describe, expect, it } from 'vitest';
import { CLAMP_THRESHOLD, detTanh } from './tanh.js';

describe('detTanh', () => {
  it('maps 0 to exactly 0', () => {
    expect(detTanh(0)).toBe(0);
  });

  it('is an exact odd function: detTanh(-x) === -detTanh(x)', () => {
    for (const x of [0.001, 0.5, 1, 2, 5, 9.5, 15, 19.999, 100, 1e6]) {
      expect(detTanh(-x)).toBe(-detTanh(x));
    }
  });

  it('is bounded in [-1, 1] over a wide grid, including large magnitudes', () => {
    for (let x = -50; x <= 50; x += 0.25) {
      const value = detTanh(x);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('is monotone non-decreasing over a wide grid, up to double-precision rounding noise', () => {
    // Near saturation the true mathematical tanh value differs from 1 by
    // far less than a double's ULP there, so consecutive grid points can be
    // bit-identical or, at the noise floor, off by ~1 ULP in either
    // direction; MONOTONE_TOLERANCE absorbs that without hiding a real
    // (much larger) ordering bug.
    const MONOTONE_TOLERANCE = 1e-12;
    let previous = -Infinity;
    for (let x = -50; x <= 50; x += 0.1) {
      const value = detTanh(x);
      expect(value).toBeGreaterThanOrEqual(previous - MONOTONE_TOLERANCE);
      previous = value;
    }
  });

  it('clamps to exactly 1 / -1 beyond CLAMP_THRESHOLD', () => {
    expect(detTanh(CLAMP_THRESHOLD + 1)).toBe(1);
    expect(detTanh(-(CLAMP_THRESHOLD + 1))).toBe(-1);
    expect(detTanh(1000)).toBe(1);
    expect(detTanh(-1000)).toBe(-1);
  });

  it('is deterministic: repeated calls with the same input are bit-identical', () => {
    for (const x of [0.37, -2.5, 8.125]) {
      expect(detTanh(x)).toBe(detTanh(x));
    }
  });

  it('approaches but has not yet saturated to 1 at a moderate magnitude', () => {
    // At x=9 the true tanh value (~0.999999997) still differs from 1 by far
    // more than a double's ULP there, so this is a real (non-clamped, non-
    // saturated) computation, unlike values close to CLAMP_THRESHOLD where
    // float64 itself cannot represent anything other than exactly 1.
    const value = detTanh(9);
    expect(value).toBeLessThan(1);
    expect(value).toBeGreaterThan(0.999);
  });
});
