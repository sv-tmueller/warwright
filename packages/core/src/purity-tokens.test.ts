import { describe, expect, it } from 'vitest';
import { findForbiddenTokenViolations } from './purity-tokens.js';

// Unit coverage for the cheap-evasion hardening added per the #135 (#67a)
// review (Fix 3): eval, new Function, and the constructor-chain trick for
// reaching the Function constructor without spelling "Function" (e.g.
// `(() => {}).constructor.constructor('return Math.random')()`), all of
// which would otherwise let a foundry submission run arbitrary
// non-deterministic code around the static scan's specifier-based checks.
describe('findForbiddenTokenViolations (Fix 3 hardening)', () => {
  it('flags eval(', () => {
    expect(findForbiddenTokenViolations('eval("1+1")')).not.toEqual([]);
  });

  it('flags eval ( with whitespace before the paren', () => {
    expect(findForbiddenTokenViolations('eval ("1+1")')).not.toEqual([]);
  });

  it('flags new Function(', () => {
    expect(findForbiddenTokenViolations('new Function("return 1")()')).not.toEqual([]);
  });

  it('flags a .constructor.constructor chain used to reach Function', () => {
    expect(
      findForbiddenTokenViolations('(() => {}).constructor.constructor("return 1")()'),
    ).not.toEqual([]);
  });

  it('does not flag ordinary, pure code', () => {
    expect(findForbiddenTokenViolations('const x = 1 + 2;')).toEqual([]);
  });
});
