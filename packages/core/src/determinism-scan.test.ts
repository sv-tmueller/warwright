import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Exhaustive belt behind the sim/ ESLint override in eslint.config.js. This
// test lives outside sim/ (deviation logged in the P0-02 sub-plan) because it
// needs fs, which the override forbids inside sim/. It reads every file
// under each SCANNED_DIR (including tests) as plain text and fails on any
// forbidden token, catching what lint misses: globalThis-style escapes and
// stray tokens in comments. Keep these regexes in sync with the override's
// lists.
//
// content/behaviors/** was added for #66 (per the #66 SUB_PLAN's "guard
// extension"): it hosts exported inference Behaviors (content/behaviors/
// policy/), whose deterministic-tanh requirement ("NOT Math.tanh") the
// FORBIDDEN_MATH regex already mechanically enforces, same as sim/'s no-
// Math.random rule.
const SCANNED_DIRS = [
  { name: 'sim', path: fileURLToPath(new URL('./sim/', import.meta.url)) },
  {
    name: 'content/behaviors',
    path: fileURLToPath(new URL('./content/behaviors/', import.meta.url)),
  },
];

const FORBIDDEN_MATH =
  /\bMath\.(random|sqrt|cbrt|pow|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|fround)\b/;

const FORBIDDEN_GLOBALS =
  /\b(Date|performance|crypto|document|window|navigator|fetch|XMLHttpRequest|WebSocket|requestAnimationFrame|localStorage|sessionStorage|globalThis|process)\b/;

const FORBIDDEN_NODE_IMPORT =
  /from\s+['"](?:node:[^'"]+|fs|path|os|crypto|http|https|net|tls|dns|dgram|child_process|worker_threads|cluster|perf_hooks|util|stream|zlib|readline|vm|inspector|async_hooks|events|buffer|process)['"]/;

const FORBIDDEN_REQUIRE = /\brequire\(/;

function findViolations(contents: string): string[] {
  const violations: string[] = [];
  if (FORBIDDEN_MATH.test(contents)) violations.push('forbidden Math member');
  if (FORBIDDEN_GLOBALS.test(contents)) violations.push('forbidden host global');
  if (FORBIDDEN_NODE_IMPORT.test(contents)) violations.push('forbidden Node import');
  if (FORBIDDEN_REQUIRE.test(contents)) violations.push('require()');
  return violations;
}

describe('determinism scan', () => {
  it.each(SCANNED_DIRS)('finds no forbidden tokens anywhere under $name/', ({ name, path }) => {
    const files = readdirSync(path, { recursive: true, encoding: 'utf8' }).filter((entry) =>
      entry.endsWith('.ts'),
    );

    expect(files.length).toBeGreaterThan(0);

    const offenders = files.flatMap((file) => {
      const contents = readFileSync(`${path}${file}`, 'utf8');
      return findViolations(contents).map((reason) => `${name}/${file}: ${reason}`);
    });

    expect(offenders).toEqual([]);
  });
});
