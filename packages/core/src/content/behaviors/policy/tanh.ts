// Deterministic float64 tanh, built from `+`, `-`, `*`, `/`, and comparisons
// ONLY -- never `Math.tanh`/`Math.exp` (ECMA-permitted-approximate,
// platform-variant across V8/JSC, already forbidden under sim/ and, per the
// #66 SUB_PLAN, under content/behaviors/** too). This function IS the
// ground truth for every exported policy Behavior's inference (see
// CLAUDE.md "Content, learned behaviors, and cosmetics"): the TS inference
// need not bit-match torch, and parity with the committed fixture is
// argmax-level with a >= 0.01 near-tie margin, comfortably above this
// approximation's error.
//
// Gauss's continued-fraction expansion for tanh, which converges for every
// finite x (evaluated bottom-up, a fixed number of levels -- a fixed op
// order, no data-dependent iteration count):
//
//   tanh(x) = x / (1 + x^2/(3 + x^2/(5 + x^2/(7 + ... /(2*TERMS + 1)))))
//
// TERMS=32 and CLAMP_THRESHOLD=20 were chosen empirically (see
// packages/core/src/policy-tanh-reference.test.ts, the out-of-scan sanity
// check against Math.tanh) so the truncated expansion matches libm tanh to
// double-precision noise (~1e-15 absolute error) across the entire
// unclamped domain; libm tanh(20) itself already rounds to exactly 1.0 in
// float64, so clamping there loses no precision.
const TERMS = 32;
export const CLAMP_THRESHOLD = 20;

export function detTanh(x: number): number {
  if (x > CLAMP_THRESHOLD) return 1;
  if (x < -CLAMP_THRESHOLD) return -1;

  const xSquared = x * x;
  let denominator = 2 * TERMS + 1;
  for (let level = TERMS; level >= 1; level -= 1) {
    const odd = 2 * level - 1;
    denominator = odd + xSquared / denominator;
  }
  return x / denominator;
}
