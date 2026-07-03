import { describe, expect, it } from 'vitest';
import { mulberry32 } from './prng.js';

describe('mulberry32', () => {
  it('produces the pinned uint32 sequence for seed 42', () => {
    const rng = mulberry32(42);
    const values = Array.from({ length: 8 }, () => rng.next());

    expect(values).toEqual([
      2581720956, 1925393290, 3661312704, 2876485805, 750819978, 2261697747, 1173505300,
      2683257857,
    ]);
  });

  it('produces the same sequence for two instances given the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);

    const valuesA = Array.from({ length: 20 }, () => a.next());
    const valuesB = Array.from({ length: 20 }, () => b.next());

    expect(valuesA).toEqual(valuesB);
  });

  it('produces floats in [0, 1) with the pinned first value', () => {
    const rng = mulberry32(42);
    const first = rng.float();

    expect(first).toBe(0.6011037519201636);

    const rest = Array.from({ length: 999 }, () => rng.float());
    for (const value of rest) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
