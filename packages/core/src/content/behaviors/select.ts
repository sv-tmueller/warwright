import type { Rng } from '../../sim/prng.js';

/**
 * Single pass over candidates, tracking the tied-for-best set. Draws from
 * rng only when a genuine tie exists (>1 candidate at the best value); a
 * single best is returned without touching rng, so identical inputs yield
 * identical actions and the RNG stream is never perturbed on non-ties.
 */
export function pickBest<T>(
  candidates: readonly T[],
  isBetter: (a: T, b: T) => boolean,
  rng: Rng,
): T | undefined {
  const first = candidates[0]; // noUncheckedIndexedAccess: check length first
  if (first === undefined) return undefined;

  let tied: T[] = [first];
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate === undefined) continue;
    const bestSoFar = tied[0];
    if (bestSoFar === undefined) continue;
    if (isBetter(candidate, bestSoFar)) {
      tied = [candidate];
    } else if (!isBetter(bestSoFar, candidate)) {
      tied.push(candidate);
    }
  }

  if (tied.length === 1) return tied[0];
  const winner = tied[rng.next() % tied.length];
  return winner ?? tied[0];
}
