import { describe, expect, it } from 'vitest';
import { parseWarband } from '@warwright/core';
import type { Warband } from '@warwright/core';
import warbandAJson from '../../../builds/warband-a.json' with { type: 'json' };
import warbandBJson from '../../../builds/warband-b.json' with { type: 'json' };
import {
  parseSeed,
  resolveSetup,
  resolveSource,
  type ResolveSourceDeps,
} from './match-setup.js';

const sampleA = parseWarband(warbandAJson);
const sampleB = parseWarband(warbandBJson);

function createDeps(loadDraft: () => Warband | null): ResolveSourceDeps {
  return { sampleA, sampleB, loadDraft };
}

describe('parseSeed', () => {
  it('accepts a positive integer string', () => {
    expect(parseSeed('42')).toEqual({ ok: true, seed: 42 });
  });

  it('accepts zero', () => {
    expect(parseSeed('0')).toEqual({ ok: true, seed: 0 });
  });

  it('accepts a negative integer string', () => {
    expect(parseSeed('-7')).toEqual({ ok: true, seed: -7 });
  });

  it('rejects an empty string', () => {
    expect(parseSeed('').ok).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(parseSeed('   ').ok).toBe(false);
  });

  it('rejects a non-numeric string', () => {
    expect(parseSeed('abc').ok).toBe(false);
  });

  it('rejects a fractional string', () => {
    expect(parseSeed('1.5').ok).toBe(false);
  });

  it('rejects a value too large to be a safe integer', () => {
    expect(parseSeed('1e99').ok).toBe(false);
  });

  it('rejects NaN-producing input', () => {
    expect(parseSeed('NaN').ok).toBe(false);
  });
});

describe('resolveSource', () => {
  it('resolves the sample-a source to the sample A warband', () => {
    const deps = createDeps(() => null);

    expect(resolveSource({ kind: 'sample', id: 'a' }, deps)).toEqual({
      ok: true,
      warband: sampleA,
    });
  });

  it('resolves the sample-b source to the sample B warband', () => {
    const deps = createDeps(() => null);

    expect(resolveSource({ kind: 'sample', id: 'b' }, deps)).toEqual({
      ok: true,
      warband: sampleB,
    });
  });

  it('resolves an upload source to the uploaded warband verbatim', () => {
    const uploaded = parseWarband(warbandAJson);
    const deps = createDeps(() => null);

    expect(
      resolveSource({ kind: 'upload', warband: uploaded, fileName: 'custom.json' }, deps),
    ).toEqual({ ok: true, warband: uploaded });
  });

  it('resolves the draft source from a successful loadDraft', () => {
    const draft = parseWarband(warbandBJson);
    const deps = createDeps(() => draft);

    expect(resolveSource({ kind: 'draft' }, deps)).toEqual({ ok: true, warband: draft });
  });

  it('reports a loud error when no draft has been saved', () => {
    const deps = createDeps(() => null);

    const result = resolveSource({ kind: 'draft' }, deps);

    expect(result.ok).toBe(false);
  });

  it('catches a throwing draft loader (corrupt JSON) instead of throwing', () => {
    const deps = createDeps(() => {
      throw new SyntaxError('Unexpected token in JSON');
    });

    const result = resolveSource({ kind: 'draft' }, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unexpected token in JSON');
    }
  });

  it('rejects a draft with an unknown content id', () => {
    const badDraft = structuredClone(warbandAJson);
    badDraft.units[0]!.roleId = 'not-a-real-role';
    const deps = createDeps(() => parseWarband(badDraft));

    const result = resolveSource({ kind: 'draft' }, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not-a-real-role');
    }
  });
});

describe('resolveSetup', () => {
  it('composes seed and both sides into a full setup on success', () => {
    const deps = createDeps(() => null);

    const result = resolveSetup(
      '42',
      { kind: 'sample', id: 'a' },
      { kind: 'sample', id: 'b' },
      deps,
    );

    expect(result).toEqual({ ok: true, seed: 42, buildA: sampleA, buildB: sampleB });
  });

  it('reports the seed error first when the seed is invalid', () => {
    const deps = createDeps(() => null);

    const result = resolveSetup(
      'not-a-seed',
      { kind: 'sample', id: 'a' },
      { kind: 'sample', id: 'b' },
      deps,
    );

    expect(result.ok).toBe(false);
  });

  it('reports side A errors before side B', () => {
    const deps = createDeps(() => null);

    const result = resolveSetup('42', { kind: 'draft' }, { kind: 'draft' }, deps);

    expect(result.ok).toBe(false);
  });

  it('reads the draft fresh on every call rather than caching it', () => {
    let current: Warband | null = null;
    const deps = createDeps(() => current);

    const first = resolveSetup('42', { kind: 'draft' }, { kind: 'sample', id: 'b' }, deps);
    expect(first.ok).toBe(false);

    current = parseWarband(warbandAJson);
    const second = resolveSetup('42', { kind: 'draft' }, { kind: 'sample', id: 'b' }, deps);
    expect(second).toEqual({ ok: true, seed: 42, buildA: current, buildB: sampleB });
  });
});
