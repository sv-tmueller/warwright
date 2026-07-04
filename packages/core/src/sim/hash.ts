import type { MatchEvent } from './events.js';

/**
 * Deterministically serializes a value: object keys are sorted by
 * Array.prototype.sort() (code-unit order), array order is preserved, and
 * values that cannot be reproduced deterministically fail loud instead of
 * silently degrading (see the determinism contract in CLAUDE.md).
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';

  const type = typeof value;

  if (type === 'string' || type === 'boolean') {
    return JSON.stringify(value);
  }

  if (type === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('stableStringify: refusing to serialize a non-finite number');
    }
    return JSON.stringify(value);
  }

  if (type === 'undefined') {
    throw new Error('stableStringify: refusing to serialize undefined');
  }

  if (type === 'function') {
    throw new Error('stableStringify: refusing to serialize a function');
  }

  if (type === 'symbol') {
    throw new Error('stableStringify: refusing to serialize a symbol');
  }

  if (type === 'bigint') {
    throw new Error('stableStringify: refusing to serialize a bigint');
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * FNV-1a, 32-bit variant, operating one UTF-16 code unit at a time.
 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

export function hashEventLog(log: MatchEvent[]): number {
  return fnv1a32(stableStringify(log));
}
