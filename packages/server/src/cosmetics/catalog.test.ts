import { describe, expect, it } from 'vitest';
import {
  cosmeticById,
  cosmeticIds,
  CosmeticSchema,
  CosmeticSlotSchema,
  COSMETICS,
  DEFAULT_COSMETIC_BY_SLOT,
} from './catalog.js';

describe('cosmetics catalog', () => {
  it('parses every entry against CosmeticSchema at module load (no throw on import)', () => {
    for (const cosmetic of COSMETICS) {
      expect(() => CosmeticSchema.parse(cosmetic)).not.toThrow();
    }
    expect(COSMETICS.length).toBeGreaterThan(0);
  });

  it('has no field mapping to any sim stat: the strictObject shape is exactly id/name/slot/defaultOwned/descriptor', () => {
    expect(Object.keys(CosmeticSchema.shape).sort()).toEqual(
      ['id', 'name', 'slot', 'defaultOwned', 'descriptor'].sort()
    );
  });

  it('has unique ids across the whole catalog', () => {
    const ids = COSMETICS.map((cosmetic) => cosmetic.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has exactly one defaultOwned cosmetic per slot', () => {
    for (const slot of CosmeticSlotSchema.options) {
      const defaults = COSMETICS.filter((c) => c.slot === slot && c.defaultOwned);
      expect(defaults).toHaveLength(1);
    }
  });

  it('every slot has at least one non-default (acquirable) cosmetic', () => {
    for (const slot of CosmeticSlotSchema.options) {
      const acquirable = COSMETICS.filter((c) => c.slot === slot && !c.defaultOwned);
      expect(acquirable.length).toBeGreaterThan(0);
    }
  });

  it('DEFAULT_COSMETIC_BY_SLOT resolves to the slot-matching, defaultOwned cosmetic id for every slot', () => {
    for (const slot of CosmeticSlotSchema.options) {
      const id = DEFAULT_COSMETIC_BY_SLOT[slot];
      expect(id).toBeDefined();
      const cosmetic = cosmeticById.get(id);
      expect(cosmetic).toBeDefined();
      expect(cosmetic!.slot).toBe(slot);
      expect(cosmetic!.defaultOwned).toBe(true);
    }
  });

  it('cosmeticIds and cosmeticById are derived from COSMETICS and stay in sync', () => {
    expect(cosmeticIds.size).toBe(COSMETICS.length);
    for (const cosmetic of COSMETICS) {
      expect(cosmeticIds.has(cosmetic.id)).toBe(true);
      expect(cosmeticById.get(cosmetic.id)).toEqual(cosmetic);
    }
  });
});
