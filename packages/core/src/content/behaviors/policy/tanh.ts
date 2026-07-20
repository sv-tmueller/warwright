// Deterministic float64 tanh, built from `+`, `-`, `*`, `/`, and comparisons
// ONLY -- never the platform's built-in trig tanh or exponential functions
// (ECMA-permitted-approximate, platform-variant across V8/JSC, already
// forbidden under sim/ and, per the #66 SUB_PLAN, under
// content/behaviors/** too -- see determinism-scan.test.ts's FORBIDDEN_MATH
// regex, which also scans comments, so this file never spells out that
// forbidden token even in prose). This function IS the ground truth for
// every exported policy Behavior's inference (see CLAUDE.md "Content,
// learned behaviors, and cosmetics"): the TS inference need not bit-match
// torch, and parity with the committed fixture is argmax-level with a
// >= 0.01 near-tie margin, comfortably above this approximation's error.
//
// Gauss's continued-fraction expansion for tanh, which converges for every
// finite x (evaluated bottom-up, a fixed number of levels -- a fixed op
// order, no data-dependent iteration count):
//
//   tanh(x) = x / (1 + x^2/(3 + x^2/(5 + x^2/(7 + ... /(2*TERMS + 1)))))
//
// TERMS=32 and CLAMP_THRESHOLD=20 were chosen empirically (see
// packages/core/src/policy-tanh-reference.test.ts, the out-of-scan sanity
// check against that platform function) so the truncated expansion matches
// the reference libm implementation to double-precision noise (~1e-15
// absolute error) across the entire unclamped domain; the reference value
// at x=20 itself already rounds to exactly 1.0 in float64, so clamping
// there loses no precision.
//
// Note: because this is a truncated approximation rather than an exact
// clamp, the output can exceed +-1 by up to 1 ULP (Number.EPSILON) at some
// saturated (but not yet CLAMP_THRESHOLD-clamped) inputs. That excess is
// harmless: it only feeds further multiplications, is far below the export
// fixture's >= 0.01 near-tie argmax margin, and doesn't affect determinism
// (still exact float64) or which component wins argmax.
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
