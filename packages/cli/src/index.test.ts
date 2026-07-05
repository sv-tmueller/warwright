import { fileURLToPath } from 'node:url';
import { RULESET_VERSION, runMatch } from '@warwright/core';
import { describe, expect, it } from 'vitest';
import { formatEventLog } from './format.js';
import { loadWarband, parseArgs } from './index.js';

describe('parseArgs', () => {
  it('parses a valid argv', () => {
    expect(
      parseArgs(['--seed', '42', '--a', 'builds/warband-a.json', '--b', 'builds/warband-b.json']),
    ).toEqual({ seed: 42, buildAPath: 'builds/warband-a.json', buildBPath: 'builds/warband-b.json' });
  });

  it('throws when --seed is missing', () => {
    expect(() => parseArgs(['--a', 'builds/warband-a.json', '--b', 'builds/warband-b.json'])).toThrow();
  });

  it('throws when --a is missing', () => {
    expect(() => parseArgs(['--seed', '42', '--b', 'builds/warband-b.json'])).toThrow();
  });

  it('throws when --b is missing', () => {
    expect(() => parseArgs(['--seed', '42', '--a', 'builds/warband-a.json'])).toThrow();
  });

  it('throws when --seed is not an integer', () => {
    expect(() =>
      parseArgs(['--seed', 'abc', '--a', 'builds/warband-a.json', '--b', 'builds/warband-b.json']),
    ).toThrow();
  });
});

// src -> cli -> packages -> repo root = three `../`.
const buildPath = (name: string) => fileURLToPath(new URL(`../../../builds/${name}`, import.meta.url));

describe('sim:run determinism', () => {
  it('produces a byte-identical formatted log across two runs with the same seed', () => {
    const buildA = loadWarband(buildPath('warband-a.json'));
    const buildB = loadWarband(buildPath('warband-b.json'));

    const r1 = runMatch({ version: RULESET_VERSION, seed: 42, buildA, buildB });
    const r2 = runMatch({ version: RULESET_VERSION, seed: 42, buildA, buildB });

    expect(formatEventLog(r1.eventLog)).toEqual(formatEventLog(r2.eventLog));
  });
});
