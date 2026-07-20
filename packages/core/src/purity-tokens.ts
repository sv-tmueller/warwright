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

/**
 * Runs every FORBIDDEN_* regex above against `contents` and returns a
 * human-readable reason string for each one that matches. Shared by
 * determinism-scan.test.ts (first-party sim/ + content/behaviors/ code) and
 * packages/foundry's stage-2 static scan (third-party submission code), so
 * both consumers report identically-worded violations for the same input.
 */
export function findForbiddenTokenViolations(contents: string): string[] {
  const violations: string[] = [];
  if (FORBIDDEN_MATH.test(contents)) violations.push('forbidden Math member');
  if (FORBIDDEN_GLOBALS.test(contents)) violations.push('forbidden host global');
  if (FORBIDDEN_NODE_IMPORT.test(contents)) violations.push('forbidden Node import');
  if (FORBIDDEN_REQUIRE.test(contents)) violations.push('require()');
  return violations;
}
