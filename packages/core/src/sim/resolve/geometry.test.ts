import { describe, expect, it } from 'vitest';
import { isInRange, isqrt, nearestBySquaredDistance, squaredDistance, stepToward } from './geometry.js';

describe('squaredDistance', () => {
  it('computes the squared distance between two points', () => {
    expect(squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
  });

  it('returns 0 for identical points', () => {
    expect(squaredDistance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });

  it('is sign-agnostic', () => {
    expect(squaredDistance({ x: 5, y: 5 }, { x: 2, y: 1 })).toBe(25);
  });
});

describe('isqrt', () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 1],
    [24, 4],
    [25, 5],
    [10000, 100],
    [20000, 141],
    [2000000, 1414],
  ])('floors the integer square root of %i to %i', (n, expected) => {
    expect(isqrt(n)).toBe(expected);
  });
});

describe('stepToward', () => {
  it('steps along the axis toward the target', () => {
    expect(stepToward({ x: 0, y: 0 }, { x: 100, y: 0 }, 10)).toEqual({ x: 10, y: 0 });
  });

  it('snaps to the target when the remaining distance equals maxStep', () => {
    expect(stepToward({ x: 0, y: 0 }, { x: 6, y: 8 }, 10)).toEqual({ x: 6, y: 8 });
  });

  it('snaps to the target when the remaining distance is less than maxStep', () => {
    expect(stepToward({ x: 0, y: 0 }, { x: 3, y: 4 }, 10)).toEqual({ x: 3, y: 4 });
  });

  it('normalizes a diagonal step by the true straight-line distance', () => {
    expect(stepToward({ x: 0, y: 0 }, { x: 100, y: 100 }, 10)).toEqual({ x: 7, y: 7 });
  });

  it('clamps the step to the upper arena bound', () => {
    expect(stepToward({ x: 995, y: 500 }, { x: 1050, y: 500 }, 10)).toEqual({ x: 1000, y: 500 });
  });

  it('clamps the step to the lower arena bound for a negative-direction move', () => {
    expect(stepToward({ x: 5, y: 500 }, { x: -100, y: 500 }, 10)).toEqual({ x: 0, y: 500 });
  });
});

describe('nearestBySquaredDistance', () => {
  it('returns the index of the nearest candidate', () => {
    const candidates = [
      { x: 100, y: 100 },
      { x: 10, y: 0 },
      { x: 50, y: 50 },
    ];
    expect(nearestBySquaredDistance({ x: 0, y: 0 }, candidates)).toBe(1);
  });

  it('breaks a tie in favor of the lowest index', () => {
    const candidates = [
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(nearestBySquaredDistance({ x: 0, y: 0 }, candidates)).toBe(0);
  });

  it('returns -1 for an empty candidate list', () => {
    expect(nearestBySquaredDistance({ x: 0, y: 0 }, [])).toBe(-1);
  });
});

describe('isInRange', () => {
  it('returns true when the squared distance exactly equals the range', () => {
    expect(isInRange({ x: 0, y: 0 }, { x: 3, y: 4 }, 25)).toBe(true);
  });

  it('returns false when the squared distance exceeds the range', () => {
    expect(isInRange({ x: 0, y: 0 }, { x: 3, y: 4 }, 24)).toBe(false);
  });
});
