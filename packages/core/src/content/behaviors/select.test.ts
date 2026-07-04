import { describe, expect, it } from 'vitest';
import type { Rng } from '../../sim/prng.js';
import { pickBest } from './select.js';

type Sample = { readonly label: string; readonly value: number };

function throwingRng(): Rng {
  return {
    next: () => {
      throw new Error('rng.next should not be called');
    },
    float: () => {
      throw new Error('rng.float should not be called');
    },
  };
}

function stubRng(values: readonly number[]): Rng {
  let i = 0;
  return {
    next: () => {
      const value = values[i];
      i += 1;
      if (value === undefined) throw new Error('stubRng ran out of values');
      return value;
    },
    float: () => {
      throw new Error('float unused in these tests');
    },
  };
}

const lower = (a: Sample, b: Sample): boolean => a.value < b.value;

describe('pickBest', () => {
  it('returns undefined for an empty candidate list', () => {
    expect(pickBest<Sample>([], lower, throwingRng())).toBeUndefined();
  });

  it('returns the single best candidate without drawing from rng', () => {
    const candidates: Sample[] = [{ label: 'a', value: 3 }];
    expect(pickBest(candidates, lower, throwingRng())).toEqual({ label: 'a', value: 3 });
  });

  it('does not draw from rng when one candidate is strictly best among many', () => {
    const candidates: Sample[] = [
      { label: 'a', value: 3 },
      { label: 'b', value: 1 },
      { label: 'c', value: 2 },
    ];
    expect(pickBest(candidates, lower, throwingRng())).toEqual({ label: 'b', value: 1 });
  });

  it('breaks a tie of two using rng.next, selecting each index in turn', () => {
    const candidates: Sample[] = [
      { label: 'a', value: 1 },
      { label: 'b', value: 1 },
    ];
    expect(pickBest(candidates, lower, stubRng([0]))).toEqual({ label: 'a', value: 1 });
    expect(pickBest(candidates, lower, stubRng([1]))).toEqual({ label: 'b', value: 1 });
  });

  it('breaks a tie of three using rng.next modulo the tied count', () => {
    const candidates: Sample[] = [
      { label: 'a', value: 1 },
      { label: 'b', value: 1 },
      { label: 'c', value: 1 },
      { label: 'd', value: 9 },
    ];
    expect(pickBest(candidates, lower, stubRng([2]))).toEqual({ label: 'c', value: 1 });
  });

  it('is deterministic: identical inputs and identical rng sequence yield identical results', () => {
    const candidates: Sample[] = [
      { label: 'a', value: 1 },
      { label: 'b', value: 1 },
      { label: 'c', value: 5 },
    ];
    const first = pickBest(candidates, lower, stubRng([1]));
    const second = pickBest(candidates, lower, stubRng([1]));
    expect(first).toEqual(second);
  });
});
