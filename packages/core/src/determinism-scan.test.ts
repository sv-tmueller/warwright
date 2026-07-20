import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findForbiddenTokenViolations } from './purity-tokens.js';

// Exhaustive belt behind the sim/ ESLint override in eslint.config.js. This
// test lives outside sim/ (deviation logged in the P0-02 sub-plan) because it
// needs fs, which the override forbids inside sim/. It reads every file
// under each SCANNED_DIR (including tests) as plain text and fails on any
// forbidden token, catching what lint misses: globalThis-style escapes and
// stray tokens in comments. The FORBIDDEN_* regexes live in purity-tokens.ts
// (see #135) so packages/foundry's stage-2 static scan can reuse the exact
// same lists; keep purity-tokens.ts in sync with eslint.config.js's
// no-restricted-globals / no-restricted-properties / no-restricted-imports
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

describe('determinism scan', () => {
  it.each(SCANNED_DIRS)('finds no forbidden tokens anywhere under $name/', ({ name, path }) => {
    const files = readdirSync(path, { recursive: true, encoding: 'utf8' }).filter((entry) =>
      entry.endsWith('.ts'),
    );

    expect(files.length).toBeGreaterThan(0);

    const offenders = files.flatMap((file) => {
      const contents = readFileSync(`${path}${file}`, 'utf8');
      return findForbiddenTokenViolations(contents).map((reason) => `${name}/${file}: ${reason}`);
    });

    expect(offenders).toEqual([]);
  });
});
