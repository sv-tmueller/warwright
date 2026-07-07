/**
 * Deterministic djb2-style hash over a string's char codes, folded to an
 * unsigned 32-bit integer. Pure and side-effect free: the same string always
 * yields the same value. Used to derive stable visual parameters (color,
 * shape, layout) from id strings. Not the sim's mulberry32 PRNG: this module
 * has no randomness to seed, just a fixed function of its input.
 */
export function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(hash, 33) ^ value.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}
