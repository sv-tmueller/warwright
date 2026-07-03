export type Rng = {
  next(): number;
  float(): number;
};

/**
 * The one seeded PRNG permitted under sim/ (bryc's mulberry32). See the
 * determinism contract in CLAUDE.md: no Math.random anywhere in the sim tree.
 */
export function mulberry32(seed: number): Rng {
  let a = seed;

  function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  function float(): number {
    return next() / 4294967296;
  }

  return { next, float };
}
