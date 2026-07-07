import type { Warband } from '@warwright/core';
import { deserializeWarband, serializeWarband } from './warband-io.js';

export type WarbandStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_KEY = 'warwright:warband-builder:draft';

// storage is injected (defaulting to the browser's localStorage) so tests
// run against a plain in-memory fake instead of a real browser API.
export function saveWarband(warband: Warband, storage: WarbandStorage = localStorage): void {
  storage.setItem(STORAGE_KEY, serializeWarband(warband));
}

export function loadWarband(storage: WarbandStorage = localStorage): Warband | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  return deserializeWarband(raw);
}

export function clearWarband(storage: WarbandStorage = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}
