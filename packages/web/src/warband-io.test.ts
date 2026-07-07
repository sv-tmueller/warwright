import { describe, expect, it } from 'vitest';
import { parseWarband } from '@warwright/core';
import warbandAJson from '../../../builds/warband-a.json' with { type: 'json' };
import warbandBJson from '../../../builds/warband-b.json' with { type: 'json' };
import warbandARaw from '../../../builds/warband-a.json?raw';
import warbandBRaw from '../../../builds/warband-b.json?raw';
import {
  deserializeWarband,
  findUnknownContentIds,
  readWarbandFile,
  serializeWarband,
  tryParseWarband,
} from './warband-io.js';

describe('serializeWarband / deserializeWarband round-trip', () => {
  it('round-trips builds/warband-a.json losslessly and byte-for-byte', () => {
    const warband = deserializeWarband(warbandARaw);

    expect(warband).toEqual(parseWarband(warbandAJson));
    expect(serializeWarband(warband)).toBe(warbandARaw);
  });

  it('round-trips builds/warband-b.json losslessly and byte-for-byte', () => {
    const warband = deserializeWarband(warbandBRaw);

    expect(warband).toEqual(parseWarband(warbandBJson));
    expect(serializeWarband(warband)).toBe(warbandBRaw);
  });
});

describe('tryParseWarband', () => {
  it('accepts a valid warband', () => {
    const warband = parseWarband(warbandAJson);

    expect(tryParseWarband(warband)).toEqual({ ok: true, warband });
  });

  it('reports a loud error for an empty name', () => {
    const badBuild = structuredClone(warbandAJson);
    badBuild.name = '';

    const result = tryParseWarband(badBuild);

    expect(result.ok).toBe(false);
  });

  it('reports a loud error for an out-of-bounds position', () => {
    const badBuild = structuredClone(warbandAJson);
    badBuild.units[0]!.position = { x: -1, y: 0 };

    const result = tryParseWarband(badBuild);

    expect(result.ok).toBe(false);
  });

  it('reports a loud error for an empty units array', () => {
    const badBuild = structuredClone(warbandAJson);
    badBuild.units = [];

    const result = tryParseWarband(badBuild);

    expect(result.ok).toBe(false);
  });
});

describe('findUnknownContentIds', () => {
  it('returns no problems for a warband built from known ids', () => {
    const warband = parseWarband(warbandAJson);

    expect(findUnknownContentIds(warband)).toEqual([]);
  });

  it('flags an unknown roleId, behaviorId, and skillId', () => {
    const badBuild = structuredClone(warbandAJson);
    badBuild.units[0]!.roleId = 'not-a-real-role';
    badBuild.units[0]!.behaviorId = 'not-a-real-behavior';
    badBuild.units[0]!.skillIds = ['not-a-real-skill'];

    const problems = findUnknownContentIds(parseWarband(badBuild));

    expect(problems).toEqual([
      expect.stringContaining('not-a-real-role'),
      expect.stringContaining('not-a-real-behavior'),
      expect.stringContaining('not-a-real-skill'),
    ]);
  });
});

describe('readWarbandFile', () => {
  it('parses a well-formed file', async () => {
    const file = new File([warbandARaw], 'warband-a.json', { type: 'application/json' });

    await expect(readWarbandFile(file)).resolves.toEqual(parseWarband(warbandAJson));
  });

  it('rejects a file with a well-formed but unknown skill id', async () => {
    const badBuild = structuredClone(warbandAJson);
    badBuild.units[0]!.skillIds = ['not-a-real-skill'];
    const file = new File([JSON.stringify(badBuild)], 'bad.json', { type: 'application/json' });

    await expect(readWarbandFile(file)).rejects.toThrow(/not-a-real-skill/);
  });
});
