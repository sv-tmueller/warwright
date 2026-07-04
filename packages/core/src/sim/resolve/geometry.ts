import { ARENA_MAX_X, ARENA_MAX_Y, ARENA_MIN_X, ARENA_MIN_Y } from '../constants.js';
import type { Position } from '../types.js';

export function squaredDistance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Integer floor of the square root, via Newton's method. Hand-rolled so
 * sim/ never reaches for the forbidden square-root function.
 */
export function isqrt(n: number): number {
  if (n < 2) return n;

  let x = n;
  let y = Math.trunc((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.trunc((x + Math.trunc(n / x)) / 2);
  }
  return x;
}

function clampX(x: number): number {
  return Math.min(Math.max(x, ARENA_MIN_X), ARENA_MAX_X);
}

function clampY(y: number): number {
  return Math.min(Math.max(y, ARENA_MIN_Y), ARENA_MAX_Y);
}

export function stepToward(from: Position, to: Position, maxStep: number): Position {
  const d2 = squaredDistance(from, to);

  if (d2 <= maxStep * maxStep) {
    return { x: clampX(to.x), y: clampY(to.y) };
  }

  // Only reached when d2 > maxStep*maxStep >= 0, so d2 >= 1 and dist >= 1:
  // no divide-by-zero is possible here.
  const dist = isqrt(d2);
  const nx = from.x + Math.trunc(((to.x - from.x) * maxStep) / dist);
  const ny = from.y + Math.trunc(((to.y - from.y) * maxStep) / dist);

  return { x: clampX(nx), y: clampY(ny) };
}

export function nearestBySquaredDistance(from: Position, candidates: readonly Position[]): number {
  let bestIndex = -1;
  let bestD2 = Infinity;

  for (let i = 0; i < candidates.length; i += 1) {
    const d2 = squaredDistance(from, candidates[i]);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export function isInRange(from: Position, to: Position, rangeSquared: number): boolean {
  return squaredDistance(from, to) <= rangeSquared;
}
