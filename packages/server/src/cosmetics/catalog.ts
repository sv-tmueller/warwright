import { z } from 'zod';

// Cosmetics-only economy (#73): the cosmetic catalog lives here, in the
// SERVER, deliberately — not in packages/core. Core has no cosmetic type to
// read, which is what makes "the sim cannot read a cosmetic" true by
// construction rather than by convention. See src/cosmetics/integrity.test.ts
// for the invariant this is load-bearing for.
//
// A Cosmetic is visual-only: CosmeticSchema is a z.strictObject with exactly
// {id, name, slot, defaultOwned, descriptor} — no field name here may ever
// map to a sim stat (no hp/armor/damage/range/speed/cooldown). `descriptor`
// is a render hint only (e.g. a color or icon key consumed by a renderer),
// never read by anything under packages/core/src/sim.

export const CosmeticSlotSchema = z.enum(['unitPalette', 'banner']);
export type CosmeticSlot = z.infer<typeof CosmeticSlotSchema>;

export const CosmeticSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  slot: CosmeticSlotSchema,
  defaultOwned: z.boolean(),
  // Visual-only render hint (e.g. a hex color or icon key). Never a sim
  // stat: nothing under packages/core/src/sim ever reads this field.
  descriptor: z.string().min(1),
});
export type Cosmetic = z.infer<typeof CosmeticSchema>;

function parseCosmetic(data: unknown): Cosmetic {
  const result = CosmeticSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid Cosmetic: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

// The seed catalog: two slots, a handful of visual-only entries each, one
// defaultOwned entry per slot. Expandable as pure data — adding an entry
// never requires touching a route or a schema.
const RAW_COSMETICS = [
  {
    id: 'palette-default',
    name: 'Default Palette',
    slot: 'unitPalette',
    defaultOwned: true,
    descriptor: '#6b7280',
  },
  {
    id: 'palette-crimson',
    name: 'Crimson Palette',
    slot: 'unitPalette',
    defaultOwned: false,
    descriptor: '#b91c1c',
  },
  {
    id: 'palette-azure',
    name: 'Azure Palette',
    slot: 'unitPalette',
    defaultOwned: false,
    descriptor: '#1d4ed8',
  },
  {
    id: 'banner-default',
    name: 'Default Banner',
    slot: 'banner',
    defaultOwned: true,
    descriptor: 'plain',
  },
  {
    id: 'banner-laurel',
    name: 'Laurel Banner',
    slot: 'banner',
    defaultOwned: false,
    descriptor: 'laurel',
  },
] satisfies unknown[];

// Validated once, at module load: an invalid catalog entry fails loudly at
// import time, never silently at request time.
export const COSMETICS: readonly Cosmetic[] = RAW_COSMETICS.map(parseCosmetic);

export const cosmeticIds: ReadonlySet<string> = new Set(COSMETICS.map((cosmetic) => cosmetic.id));

export const cosmeticById: ReadonlyMap<string, Cosmetic> = new Map(
  COSMETICS.map((cosmetic) => [cosmetic.id, cosmetic])
);

function computeDefaultsBySlot(): Record<CosmeticSlot, string> {
  const result = {} as Record<CosmeticSlot, string>;
  for (const slot of CosmeticSlotSchema.options) {
    const defaults = COSMETICS.filter((cosmetic) => cosmetic.slot === slot && cosmetic.defaultOwned);
    if (defaults.length !== 1) {
      throw new Error(
        `Cosmetic catalog invariant violated: slot "${slot}" must have exactly one defaultOwned entry, found ${defaults.length}`
      );
    }
    result[slot] = defaults[0]!.id;
  }
  return result;
}

// One defaultOwned cosmeticId per slot — the effective selection when an
// account has no explicit cosmetic_selection row for that slot (see
// src/cosmetics/routes.ts's lazy-default read).
export const DEFAULT_COSMETIC_BY_SLOT: Readonly<Record<CosmeticSlot, string>> = computeDefaultsBySlot();
