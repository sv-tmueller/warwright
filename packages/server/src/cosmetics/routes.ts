import { and, eq } from 'drizzle-orm';
import type { preHandlerHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { cosmeticOwnership, cosmeticSelection } from '../db/schema.js';
import { cosmeticById, CosmeticSchema, CosmeticSlotSchema, COSMETICS, DEFAULT_COSMETIC_BY_SLOT } from './catalog.js';
import type { EntitlementProvider } from './entitlement.js';

export interface CosmeticRoutesOptions {
  db: Database;
  entitlementProvider: EntitlementProvider;
}

const GENERIC_NOT_AUTHENTICATED = { error: 'Not authenticated' } as const;

const ErrorSchema = z.object({ error: z.string() });

const AcquireBodySchema = z.strictObject({ cosmeticId: z.string().min(1) });
const SelectionBodySchema = z.strictObject({ slot: CosmeticSlotSchema, cosmeticId: z.string().min(1) });

const CosmeticStateSchema = z.object({
  owned: z.array(z.string()),
  selection: z.record(CosmeticSlotSchema, z.string()),
});

const AcquireResponseSchema = z.object({ cosmeticId: z.string(), owned: z.literal(true) });
const SelectionResponseSchema = z.object({ slot: CosmeticSlotSchema, cosmeticId: z.string() });

/**
 * Registers the /cosmetics routes (catalog read, owned/selection read,
 * acquire, select), scoped to the caller's own account. Must be registered
 * after the session plugin, mirroring src/warbands/routes.ts's requirements
 * and hook ordering exactly (see its matching comments).
 *
 * Every query is scoped `WHERE user_id = :sessionUserId`; a cosmetic is
 * never even representable as a sim-input field (see
 * src/cosmetics/integrity.test.ts) — these routes only ever read/write the
 * disjoint cosmetic_ownership/cosmetic_selection tables, never
 * warbands/matches.
 */
const cosmeticRoutes: FastifyPluginAsyncZod<CosmeticRoutesOptions> = async (app, options) => {
  const { db, entitlementProvider } = options;

  const csrfProtection: preHandlerHookHandler = (request, reply, done) =>
    app.csrfProtection(request, reply, done);

  app.addHook('onRequest', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) {
      reply.code(401).send(GENERIC_NOT_AUTHENTICATED);
    }
  });

  app.get('/cosmetics/catalog', { schema: { response: { 200: z.array(CosmeticSchema) } } }, async () => {
    return [...COSMETICS];
  });

  app.get('/cosmetics', { schema: { response: { 200: CosmeticStateSchema } } }, async (request) => {
    const userId = request.session.get('userId')!;

    const ownershipRows = await db
      .select()
      .from(cosmeticOwnership)
      .where(eq(cosmeticOwnership.userId, userId));
    const ownedIds = new Set(ownershipRows.map((row) => row.cosmeticId));
    const owned = COSMETICS.filter((cosmetic) => cosmetic.defaultOwned || ownedIds.has(cosmetic.id)).map(
      (cosmetic) => cosmetic.id
    );

    const selectionRows = await db
      .select()
      .from(cosmeticSelection)
      .where(eq(cosmeticSelection.userId, userId));
    const selection: Record<string, string> = { ...DEFAULT_COSMETIC_BY_SLOT };
    for (const row of selectionRows) {
      selection[row.slot] = row.cosmeticId;
    }

    return { owned, selection };
  });

  app.post(
    '/cosmetics/acquire',
    {
      onRequest: csrfProtection,
      schema: {
        body: AcquireBodySchema,
        response: { 201: AcquireResponseSchema, 400: ErrorSchema },
      },
    },
    async (request, reply) => {
      const userId = request.session.get('userId')!;
      const { cosmeticId } = request.body;

      const cosmetic = cosmeticById.get(cosmeticId);
      if (!cosmetic) {
        reply.code(400);
        return { error: `Unknown cosmeticId "${cosmeticId}"` };
      }

      const entitlement = await entitlementProvider.grantEntitlement({ userId, cosmeticId });
      if (!entitlement.granted) {
        reply.code(400);
        return { error: entitlement.reason };
      }

      await db
        .insert(cosmeticOwnership)
        .values({ userId, cosmeticId: entitlement.cosmeticId, sourceKind: 'entitlement-grant' })
        .onConflictDoNothing();

      reply.code(201);
      return { cosmeticId: entitlement.cosmeticId, owned: true as const };
    }
  );

  app.put(
    '/cosmetics/selection',
    {
      onRequest: csrfProtection,
      schema: {
        body: SelectionBodySchema,
        response: { 200: SelectionResponseSchema, 400: ErrorSchema, 403: ErrorSchema },
      },
    },
    async (request, reply) => {
      const userId = request.session.get('userId')!;
      const { slot, cosmeticId } = request.body;

      const cosmetic = cosmeticById.get(cosmeticId);
      if (!cosmetic) {
        reply.code(400);
        return { error: `Unknown cosmeticId "${cosmeticId}"` };
      }
      if (cosmetic.slot !== slot) {
        reply.code(400);
        return { error: `cosmeticId "${cosmeticId}" is not in slot "${slot}"` };
      }

      if (!cosmetic.defaultOwned) {
        const [ownershipRow] = await db
          .select()
          .from(cosmeticOwnership)
          .where(and(eq(cosmeticOwnership.userId, userId), eq(cosmeticOwnership.cosmeticId, cosmeticId)));
        if (!ownershipRow) {
          reply.code(403);
          return { error: `cosmeticId "${cosmeticId}" is not owned by this account` };
        }
      }

      await db
        .insert(cosmeticSelection)
        .values({ userId, slot, cosmeticId, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [cosmeticSelection.userId, cosmeticSelection.slot],
          set: { cosmeticId, updatedAt: new Date() },
        });

      return { slot, cosmeticId };
    }
  );
};

export default cosmeticRoutes;
