/**
 * Cosmetic-integrity invariant test (#73) — THE deliverable of this slice.
 *
 * Soundness argument: sim input is `Replay = {version, seed, buildA,
 * buildB}`; buildA/buildB funnel through `parseWarband` before any tick.
 * `WarbandSchema` and `UnitBuildSchema` are both `z.strictObject`, so the key
 * set the sim can read is CLOSED = `{name, units: [{roleId, skillIds,
 * behaviorId, position}]}`. Cosmetics live in a disjoint table namespace
 * (cosmetic_ownership, cosmetic_selection) plus a server-only catalog
 * (src/cosmetics/catalog.ts), unimported by resolve.ts or the Replay path;
 * core has no cosmetic symbol at all. Therefore a cosmetic has no
 * representable slot in the sim-input type AND no read on the resolve path.
 *
 * Four assertions prove this:
 *   1. (PRIMARY, type boundary) None of the cosmetic-shaped keys (cosmetic
 *      slot names, or catalog field names like cosmeticId/slot/descriptor/
 *      defaultOwned) is a key of UnitBuildSchema.shape or WarbandSchema.shape
 *      — the sim-input keyspace contains no cosmetic-shaped key, though it
 *      legitimately contains other non-cosmetic sim inputs (e.g. augmentIds,
 *      added by #157/Phase 4 Slice A). parseWarband also throws the instant
 *      a cosmetic-shaped key is injected — at the Warband level and inside a
 *      UnitBuild — for every cosmetic slot name plus catalog field name plus
 *      a representative cosmeticId. This is tied to the strictObject
 *      boundary guarding the only door into runMatch, not a "we didn't wire
 *      it up" test: it fails loudly the moment a future change adds a
 *      cosmetic-shaped key to a sim-input schema.
 *   2. (resolve-path namespace) ResolveMatchInput has no cosmetic field at
 *      compile time — neither a literal cosmeticId field nor any of the
 *      cosmetic slot names (unitPalette/banner) — (a type-level assertion
 *      enforced by `pnpm typecheck`), and at runtime a persisted
 *      matches.buildA/buildB deep-equals parseWarband's output and contains
 *      no cosmetic keys.
 *   3. (behavioral resolve-invariance, the acceptance test) A fixed
 *      {seed, buildA, buildB} resolves to an identical winner + hash +
 *      event-log hash regardless of cosmetic state — proven both DB-free
 *      (looping runMatch on a fixed Replay while mutating an in-memory
 *      cosmetic object) and, once cosmetic tables exist, against a real DB
 *      varying actual ownership/selection rows.
 *   4. (anti-loot-box) noopEntitlementProvider.grantEntitlement returns
 *      exactly the requested cosmeticId, never a random one, and the
 *      interface exposes no random-draw method.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWarband, runMatch, RULESET_VERSION, UnitBuildSchema, WarbandSchema } from '@warwright/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { matches } from '../db/schema.js';
import type { ResolveMatchInput } from '../matches/resolve.js';
import { resolveMatch } from '../matches/resolve.js';
import { COSMETICS, CosmeticSlotSchema, DEFAULT_COSMETIC_BY_SLOT } from './catalog.js';
import { noopEntitlementProvider, type EntitlementProvider } from './entitlement.js';

const url = process.env.DATABASE_URL;

if (process.env.CI && !url) {
  throw new Error('CI must provide DATABASE_URL for DB-gated tests.');
}

function loadBuild(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../../../../builds/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

const warbandA = loadBuild('warband-a.json');
const warbandB = loadBuild('warband-b.json');

// Every cosmetic slot name, plus every cosmetic-shaped field name (the
// catalog's own field names, and the generic "cosmeticId" a route body
// uses), each paired with a representative cosmeticId value: exactly what a
// (hypothetical, wrong) implementation would inject if it tried to smuggle
// cosmetic state through the sim-input path.
const COSMETIC_INJECTION_KEYS = [
  ...CosmeticSlotSchema.options,
  'cosmeticId',
  'slot',
  'descriptor',
  'defaultOwned',
];
const REPRESENTATIVE_COSMETIC_ID = 'palette-crimson';

// The known, legitimate sim-input keys as of this ruleset version. Used only
// as an optional, secondary "closed keyspace" guard below — it is NOT the
// primary invariant (see the no-cosmetic-key assertions), because this list
// legitimately grows over time (e.g. augmentIds, added by #157/Phase 4 Slice
// A) whereas the cosmetic-shaped keyspace must never appear here at all.
const KNOWN_UNIT_BUILD_KEYS = ['roleId', 'skillIds', 'behaviorId', 'position', 'augmentIds'];
const KNOWN_WARBAND_KEYS = ['name', 'units'];

describe('Assertion 1 (PRIMARY): the sim-input keyspace is closed', () => {
  // augmentIds is a legitimate, non-cosmetic sim input (a real gameplay
  // mechanic resolved by packages/core/src/sim, added by #157/Phase 4 Slice
  // A) — it is expected and allowed to be a key of UnitBuildSchema.shape.
  // Cosmetic-shaped keys (slot names, catalog field names) are categorically
  // different: they must NEVER appear as a key of a sim-input schema,
  // because a cosmetic is visual-only and must have zero representable slot
  // in anything the sim reads. That is the true invariant this test proves
  // — not "the key set never changes" (over-strict, and now false), but "the
  // key set never contains a cosmetic-shaped key" (still true, and the only
  // thing #73's soundness argument actually needs).
  it('none of the cosmetic-shaped keys is a key of UnitBuildSchema.shape', () => {
    const shapeKeys = new Set(Object.keys(UnitBuildSchema.shape));
    for (const cosmeticKey of COSMETIC_INJECTION_KEYS) {
      expect(shapeKeys.has(cosmeticKey)).toBe(false);
    }
  });

  it('none of the cosmetic-shaped keys is a key of WarbandSchema.shape', () => {
    const shapeKeys = new Set(Object.keys(WarbandSchema.shape));
    for (const cosmeticKey of COSMETIC_INJECTION_KEYS) {
      expect(shapeKeys.has(cosmeticKey)).toBe(false);
    }
  });

  // Secondary, optional closed-keyspace guard: catches an unexpected key
  // (cosmetic-shaped or otherwise) landing on a sim-input schema without
  // being deliberately added to the known-keys list above.
  it('UnitBuildSchema.shape keys are a subset of the known sim-input keys', () => {
    for (const key of Object.keys(UnitBuildSchema.shape)) {
      expect(KNOWN_UNIT_BUILD_KEYS).toContain(key);
    }
  });

  it('WarbandSchema.shape keys are a subset of the known sim-input keys', () => {
    for (const key of Object.keys(WarbandSchema.shape)) {
      expect(KNOWN_WARBAND_KEYS).toContain(key);
    }
  });

  it.each(COSMETIC_INJECTION_KEYS)(
    'parseWarband throws when a cosmetic-shaped key ("%s") is injected at the Warband level',
    (key) => {
      const injected = { ...warbandA, [key]: REPRESENTATIVE_COSMETIC_ID };
      expect(() => parseWarband(injected)).toThrow();
    }
  );

  it.each(COSMETIC_INJECTION_KEYS)(
    'parseWarband throws when a cosmetic-shaped key ("%s") is injected inside a UnitBuild',
    (key) => {
      const units = warbandA.units as Array<Record<string, unknown>>;
      const injected = {
        ...warbandA,
        units: [{ ...units[0], [key]: REPRESENTATIVE_COSMETIC_ID }, ...units.slice(1)],
      };
      expect(() => parseWarband(injected)).toThrow();
    }
  );
});

describe('Assertion 2: the resolve path has no cosmetic namespace', () => {
  // Compile-time: if ResolveMatchInput ever gains a field literally named
  // "cosmeticId" OR named after a cosmetic slot ("unitPalette"/"banner"),
  // that name becomes a member of the intersection of keyof
  // ResolveMatchInput with this cosmetic-key union, so the intersection is
  // no longer `never` and assigning `true` below fails to type-check —
  // caught by `pnpm typecheck`, not by any runtime assertion. A guard on
  // 'cosmeticId' alone would miss a slot-named field (e.g. `unitPalette:
  // string` smuggled onto ResolveMatchInput); this catches both shapes.
  type CosmeticKey = 'cosmeticId' | 'unitPalette' | 'banner';
  type ResolveMatchInputHasNoCosmeticKey = keyof ResolveMatchInput & CosmeticKey extends never ? true : never;
  const _noCosmeticKey: ResolveMatchInputHasNoCosmeticKey = true;
  void _noCosmeticKey;

  it('a well-formed ResolveMatchInput has exactly the documented properties (no cosmetic field)', () => {
    const sample: ResolveMatchInput = {
      userAId: 'user-a',
      userBId: 'user-b',
      buildA: warbandA,
      buildB: warbandB,
      seed: 1,
    };
    expect(Object.keys(sample).sort()).toEqual(
      ['userAId', 'userBId', 'buildA', 'buildB', 'seed'].sort()
    );
  });

  describe.skipIf(!url)('runtime: a persisted match row contains no cosmetic keys', () => {
    let db: Database;
    let pool: Awaited<ReturnType<typeof createDb>>['pool'];

    beforeAll(async () => {
      ({ db, pool } = createDb(url!));
      await runMigrations(url!);
    });

    afterAll(async () => {
      await pool.end();
    });

    it('persisted matches.buildA/buildB deep-equal parseWarband output and contain no cosmetic keys', async () => {
      const app = buildApp({
        db,
        pool,
        session: { secret: 'a'.repeat(32), cookieSecure: false, pruneSessionInterval: false },
      });

      const preCsrf = await app.inject({ method: 'GET', url: '/auth/csrf' });
      const preCookie = (preCsrf.headers['set-cookie'] as string).split(';', 1)[0]!;
      const { csrfToken } = preCsrf.json() as { csrfToken: string };
      const registerA = await app.inject({
        method: 'POST',
        url: '/auth/register',
        headers: { cookie: preCookie, 'csrf-token': csrfToken },
        payload: { email: `integrity-a-${Date.now()}@example.com`, password: 'correct horse battery staple' },
      });
      const userAId = (registerA.json() as { id: string }).id;

      const preCsrf2 = await app.inject({ method: 'GET', url: '/auth/csrf' });
      const preCookie2 = (preCsrf2.headers['set-cookie'] as string).split(';', 1)[0]!;
      const { csrfToken: csrfToken2 } = preCsrf2.json() as { csrfToken: string };
      const registerB = await app.inject({
        method: 'POST',
        url: '/auth/register',
        headers: { cookie: preCookie2, 'csrf-token': csrfToken2 },
        payload: { email: `integrity-b-${Date.now()}@example.com`, password: 'correct horse battery staple' },
      });
      const userBId = (registerB.json() as { id: string }).id;

      const { matchId } = await resolveMatch(db, {
        userAId,
        userBId,
        buildA: warbandA,
        buildB: warbandB,
        seed: 99,
      });

      const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
      expect(row).toBeDefined();
      expect(row!.buildA).toEqual(parseWarband(warbandA));
      expect(row!.buildB).toEqual(parseWarband(warbandB));

      for (const key of COSMETIC_INJECTION_KEYS) {
        expect(Object.keys(row!.buildA as object)).not.toContain(key);
        expect(Object.keys(row!.buildB as object)).not.toContain(key);
      }

      await app.close();
    });
  });
});

describe('Assertion 3: behavioral resolve-invariance', () => {
  it('DB-free: runMatch produces an identical hash + winner across a fixed Replay while an in-memory cosmetic object is mutated arbitrarily', () => {
    const replay = {
      version: RULESET_VERSION,
      seed: 42,
      buildA: parseWarband(warbandA),
      buildB: parseWarband(warbandB),
    };

    // Deliberately not read by runMatch at all: mutating it before every
    // call is exactly what would leak into the sim if cosmetics were ever
    // (wrongly) threaded through.
    const cosmeticState: Record<string, unknown> = {};
    const baseline = runMatch(replay);

    const mutations: Array<() => void> = [
      () => {
        cosmeticState['unitPalette'] = 'palette-crimson';
      },
      () => {
        cosmeticState['banner'] = 'banner-laurel';
      },
      () => {
        delete cosmeticState['unitPalette'];
      },
      () => {
        cosmeticState['unitPalette'] = 'palette-azure';
        cosmeticState['banner'] = 'banner-default';
      },
      () => {
        for (const key of Object.keys(cosmeticState)) delete cosmeticState[key];
      },
    ];

    for (const mutate of mutations) {
      mutate();
      const result = runMatch(replay);
      expect(result.hash).toBe(baseline.hash);
      expect(result.winner).toBe(baseline.winner);
      expect(result.eventLog).toEqual(baseline.eventLog);
    }
  });

  describe.skipIf(!url)(
    'the acceptance test: resolveMatch against a real DB is invariant across varied real cosmetic ownership/selection state',
    () => {
      let db: Database;
      let pool: Awaited<ReturnType<typeof createDb>>['pool'];

      beforeAll(async () => {
        ({ db, pool } = createDb(url!));
        await runMigrations(url!);
      });

      afterAll(async () => {
        await pool.end();
      });

      function extractCookie(setCookieHeader: string | string[] | undefined): string {
        const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
        if (!header) throw new Error('expected a Set-Cookie header');
        return header.split(';', 1)[0] ?? '';
      }

      it('winner + hash + event-log are identical across maximal/none, swapped, and cleared cosmetic states', async () => {
        const app = buildApp({
          db,
          pool,
          session: { secret: 'a'.repeat(32), cookieSecure: false, pruneSessionInterval: false },
        });

        async function registerUser() {
          const preCsrf = await app.inject({ method: 'GET', url: '/auth/csrf' });
          const preCookie = extractCookie(preCsrf.headers['set-cookie']);
          const { csrfToken: preToken } = preCsrf.json() as { csrfToken: string };
          const registerResponse = await app.inject({
            method: 'POST',
            url: '/auth/register',
            headers: { cookie: preCookie, 'csrf-token': preToken },
            payload: {
              email: `integrity-behavioral-${Date.now()}-${Math.random()}@example.com`,
              password: 'correct horse battery staple',
            },
          });
          const { id } = registerResponse.json() as { id: string };
          const cookie = extractCookie(registerResponse.headers['set-cookie']);
          const csrfResponse = await app.inject({ method: 'GET', url: '/auth/csrf', headers: { cookie } });
          const { csrfToken } = csrfResponse.json() as { csrfToken: string };
          return { id, cookie, csrfToken };
        }

        async function acquireAndSelectMaximal(account: { cookie: string; csrfToken: string }) {
          for (const cosmetic of COSMETICS.filter((c) => !c.defaultOwned)) {
            const response = await app.inject({
              method: 'POST',
              url: '/cosmetics/acquire',
              headers: { cookie: account.cookie, 'csrf-token': account.csrfToken },
              payload: { cosmeticId: cosmetic.id },
            });
            expect(response.statusCode).toBe(201);
          }
          for (const slot of CosmeticSlotSchema.options) {
            const nonDefault = COSMETICS.find((c) => c.slot === slot && !c.defaultOwned)!;
            const response = await app.inject({
              method: 'PUT',
              url: '/cosmetics/selection',
              headers: { cookie: account.cookie, 'csrf-token': account.csrfToken },
              payload: { slot, cosmeticId: nonDefault.id },
            });
            expect(response.statusCode).toBe(200);
          }
        }

        async function resetSelectionToDefaults(account: { cookie: string; csrfToken: string }) {
          for (const slot of CosmeticSlotSchema.options) {
            const response = await app.inject({
              method: 'PUT',
              url: '/cosmetics/selection',
              headers: { cookie: account.cookie, 'csrf-token': account.csrfToken },
              payload: { slot, cosmeticId: DEFAULT_COSMETIC_BY_SLOT[slot] },
            });
            expect(response.statusCode).toBe(200);
          }
        }

        const userA = await registerUser();
        const userB = await registerUser();

        async function resolveFixed() {
          return resolveMatch(db, {
            userAId: userA.id,
            userBId: userB.id,
            buildA: warbandA,
            buildB: warbandB,
            seed: 123,
          });
        }

        // State 1: A has a maximal cosmetic loadout (every acquirable
        // cosmetic owned and selected), B has none beyond the catalog
        // defaults.
        await acquireAndSelectMaximal(userA);
        const state1 = await resolveFixed();

        // State 2 (swap): A's selection resets to catalog defaults (still
        // owns everything, just not selected), B now acquires and selects
        // the maximal loadout instead.
        await resetSelectionToDefaults(userA);
        await acquireAndSelectMaximal(userB);
        const state2 = await resolveFixed();

        // State 3 (clear): both accounts' selections reset to catalog
        // defaults (ownership rows remain, but nothing non-default is
        // selected on either side).
        await resetSelectionToDefaults(userB);
        const state3 = await resolveFixed();

        expect(state2.result.winner).toBe(state1.result.winner);
        expect(state2.result.hash).toBe(state1.result.hash);
        expect(state2.result.eventLog).toEqual(state1.result.eventLog);

        expect(state3.result.winner).toBe(state1.result.winner);
        expect(state3.result.hash).toBe(state1.result.hash);
        expect(state3.result.eventLog).toEqual(state1.result.eventLog);

        await app.close();
      });
    }
  );
});

describe('Assertion 4: anti-loot-box', () => {
  it('noopEntitlementProvider.grantEntitlement returns exactly the requested cosmeticId, never a random one', async () => {
    const result = await noopEntitlementProvider.grantEntitlement({
      userId: 'user-1',
      cosmeticId: REPRESENTATIVE_COSMETIC_ID,
    });
    expect(result).toEqual({ granted: true, cosmeticId: REPRESENTATIVE_COSMETIC_ID });
  });

  it('EntitlementProvider exposes no random-draw method', () => {
    const provider: EntitlementProvider = noopEntitlementProvider;
    expect(Object.keys(provider)).toEqual(['grantEntitlement']);
  });
});
