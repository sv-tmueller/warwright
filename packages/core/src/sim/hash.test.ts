import { describe, expect, it } from 'vitest';
import { fnv1a32, stableStringify } from './hash.js';

describe('stableStringify', () => {
  it('produces the same string for the same object across repeated calls', () => {
    const value = { a: 1, b: [1, 2, 3], c: { nested: true } };

    expect(stableStringify(value)).toBe(stableStringify(value));
  });

  it('is independent of the order keys were declared in', () => {
    const forward = { a: 1, b: { c: 2, d: 3 } };
    const reverse = { b: { d: 3, c: 2 }, a: 1 };

    expect(stableStringify(forward)).toBe(stableStringify(reverse));
  });

  it('is sensitive to array order', () => {
    const first = [1, 2, 3];
    const second = [3, 2, 1];

    expect(stableStringify(first)).not.toBe(stableStringify(second));
  });

  it('throws on non-finite numbers', () => {
    expect(() => stableStringify(Number.NaN)).toThrow();
    expect(() => stableStringify(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => stableStringify(Number.NEGATIVE_INFINITY)).toThrow();
  });

  it('throws on undefined', () => {
    expect(() => stableStringify(undefined)).toThrow();
  });

  it('throws on functions', () => {
    expect(() => stableStringify(() => 1)).toThrow();
  });

  it('throws on symbols', () => {
    expect(() => stableStringify(Symbol('s'))).toThrow();
  });

  it('throws on bigints', () => {
    expect(() => stableStringify(1n)).toThrow();
  });
});

describe('fnv1a32', () => {
  it('matches the FNV-1a-32 offset basis for the empty string', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });

  it('matches a reference FNV-1a-32 implementation for known vectors', () => {
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('returns an integer in the uint32 range', () => {
    const result = fnv1a32('some arbitrary text to hash');

    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(2 ** 32);
  });
});
