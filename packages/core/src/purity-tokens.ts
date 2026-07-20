// Forbidden-token / forbidden-import regexes for the determinism contract
// (see CLAUDE.md). Extracted from determinism-scan.test.ts (which still runs
// the exhaustive fs-based scan over sim/ and content/behaviors/) so
// packages/foundry's stage-2 static purity scan (see the #135 SUB_PLAN) can
// hold third-party submissions to the exact same bar via the exact same
// lists, instead of re-implementing or drifting from them.
//
// Keep these regexes in sync with eslint.config.js's no-restricted-globals /
// no-restricted-properties / no-restricted-imports lists: lint gives fast
// feedback inside this repo, this module is the exhaustive belt (it also
// catches escapes like globalThis.crypto and applies to code outside this
// repo's lint config, e.g. a foundry submission).

export const FORBIDDEN_MATH =
  /\bMath\.(random|sqrt|cbrt|pow|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|fround)\b/;

export const FORBIDDEN_GLOBALS =
  /\b(Date|performance|crypto|document|window|navigator|fetch|XMLHttpRequest|WebSocket|requestAnimationFrame|localStorage|sessionStorage|globalThis|process)\b/;

export const FORBIDDEN_NODE_IMPORT =
  /from\s+['"](?:node:[^'"]+|fs|path|os|crypto|http|https|net|tls|dns|dgram|child_process|worker_threads|cluster|perf_hooks|util|stream|zlib|readline|vm|inspector|async_hooks|events|buffer|process)['"]/;

export const FORBIDDEN_REQUIRE = /\brequire\(/;

// Cheap-evasion hardening (Fix 3, review of PR #136): eval and `new
// Function(...)` are direct code-execution primitives that bypass every
// other token/import check below them; a `.constructor.constructor` (or any
// `constructor` chain) is the standard trick for reaching the Function
// constructor without ever spelling "Function" in source, e.g.
// `(() => {}).constructor.constructor('return Math.random()')()`.
export const FORBIDDEN_EVAL = /\beval\s*\(/;
export const FORBIDDEN_NEW_FUNCTION = /\bnew\s+Function\s*\(/;
export const FORBIDDEN_CONSTRUCTOR_CHAIN = /\.constructor(?:\s*\.\s*constructor|\s*\[\s*['"]constructor['"]\s*\])/;

/**
 * Runs every FORBIDDEN_* regex above against `contents` and returns a
 * human-readable reason string for each one that matches. Shared by
 * determinism-scan.test.ts (first-party sim/ + content/behaviors/ code) and
 * packages/foundry's stage-2 static scan (third-party submission code), so
 * both consumers report identically-worded violations for the same input.
 *
 * This is a text-based, exhaustive-but-not-airtight belt, not a full static
 * analyzer: computed member access via a non-literal string (e.g.
 * `Math[randomKey()]`, `globalThis['Math']`) is not caught by these
 * regexes. For sim/ and content/behaviors/ (first-party code, backstopped
 * by lint + code review) that residual gap is acceptable. For a foundry
 * submission (packages/foundry/src/purity.ts) it means this scan is a
 * cooperative-CI gate against accidental non-determinism, not a hostile
 * sandbox against a deliberately adversarial submitter.
 */
export function findForbiddenTokenViolations(contents: string): string[] {
  const violations: string[] = [];
  if (FORBIDDEN_MATH.test(contents)) violations.push('forbidden Math member');
  if (FORBIDDEN_GLOBALS.test(contents)) violations.push('forbidden host global');
  if (FORBIDDEN_NODE_IMPORT.test(contents)) violations.push('forbidden Node import');
  if (FORBIDDEN_REQUIRE.test(contents)) violations.push('require()');
  if (FORBIDDEN_EVAL.test(contents)) violations.push('eval()');
  if (FORBIDDEN_NEW_FUNCTION.test(contents)) violations.push('new Function()');
  if (FORBIDDEN_CONSTRUCTOR_CHAIN.test(contents)) {
    violations.push('constructor-chain (used to reach Function without naming it)');
  }
  return violations;
}
