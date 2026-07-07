import { describe, expect, it } from 'vitest';
import { parseWarband } from '@warwright/core';
import warbandAJson from '../../../builds/warband-a.json' with { type: 'json' };
import { loadWarband, saveWarband } from './persistence.js';
import type { WarbandStorage } from './persistence.js';

function createMemoryStorage(): WarbandStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe('persistence', () => {
  it('returns null when nothing has been saved', () => {
    const storage = createMemoryStorage();

    expect(loadWarband(storage)).toBeNull();
  });

  it('round-trips a saved warband through load', () => {
    const storage = createMemoryStorage();
    const warband = parseWarband(warbandAJson);

    saveWarband(warband, storage);

    expect(loadWarband(storage)).toEqual(warband);
  });
});
