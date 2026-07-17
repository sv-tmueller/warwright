import { behaviorIds, roles, skills, WarbandSchema, type Warband } from '@warwright/core';
import { and, eq } from 'drizzle-orm';
import type { preHandlerHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { warbands } from '../db/schema.js';

export interface WarbandRoutesOptions {
  db: Database;
}

const GENERIC_NOT_AUTHENTICATED = { error: 'Not authenticated' } as const;
const GENERIC_NOT_FOUND = { error: 'Warband not found' } as const;

const ErrorSchema = z.object({ error: z.string() });

const IdParamsSchema = z.object({ id: z.uuid() });

const WarbandListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const WarbandDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  data: WarbandSchema,
});

type WarbandRow = typeof warbands.$inferSelect;

const roleIdSet = new Set<string>(roles.map((role) => role.id));
const skillIdSet = new Set<string>(skills.map((skill) => skill.id));
const behaviorIdSet = new Set<string>(behaviorIds);

/**
 * Set-membership check against core's own exported content registry
 * (roles, skills, behaviorIds) — data reuse, not a re-implementation of any
 * sim rule. A structurally valid Warband (WarbandSchema passes) can still
 * name a roleId/skillId/behaviorId core doesn't register, which would make
 * runMatch's init() throw at match time; reject it here instead, at write
 * time, naming the offending id.
 */
function findUnknownContentId(warband: Warband): string | undefined {
  for (const unit of warband.units) {
    if (!roleIdSet.has(unit.roleId)) return `Unknown roleId "${unit.roleId}"`;
    for (const skillId of unit.skillIds) {
      if (!skillIdSet.has(skillId)) return `Unknown skillId "${skillId}"`;
    }
    if (!behaviorIdSet.has(unit.behaviorId)) return `Unknown behaviorId "${unit.behaviorId}"`;
  }
  return undefined;
}

function serializeListItem(row: WarbandRow) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeDetail(row: WarbandRow) {
  // row.data is jsonb, typed `unknown` by drizzle. This cast is a
  // compile-time convenience only: the response schema (WarbandDetailSchema,
  // which nests WarbandSchema) re-validates it via fastify-type-provider-
  // zod's serializer on every response, so a corrupted row still fails
  // loudly (a 500 from ResponseSerializationError) at the actual trust
  // boundary, not silently here.
  return { ...serializeListItem(row), data: row.data as Warband };
}

/**
 * Registers the /warbands routes (list, create, read, update, delete),
 * scoped to the caller's own account. Must be registered after the session
 * plugin (src/plugins/session.ts) has attached request.session and
 * app.csrfProtection; see src/app.ts's registration order — mirrors
 * src/auth/routes.ts's requirements exactly.
 *
 * Every SELECT/UPDATE/DELETE is scoped `WHERE id = :id AND user_id =
 * :sessionUserId`, so a foreign row and a nonexistent row are
 * indistinguishable by construction: both 404. No code path finds a row
 * and then checks ownership.
 */
const warbandRoutes: FastifyPluginAsyncZod<WarbandRoutesOptions> = async (app, options) => {
  const { db } = options;

  // app.csrfProtection is attached by the session plugin's own (deferred,
  // asynchronous) registration; referencing it lazily inside the hook
  // wrapper, rather than capturing app.csrfProtection at registration time,
  // ensures the hook sees the real decorator once boot has completed. See
  // the matching comment in src/auth/routes.ts.
  const csrfProtection: preHandlerHookHandler = (request, reply, done) =>
    app.csrfProtection(request, reply, done);

  // Plugin-scoped onRequest hook: every /warbands route requires an
  // authenticated session. Registered as onRequest (not preHandler) so it
  // runs before each mutating route's own onRequest CSRF check (Fastify
  // merges application-level hooks ahead of route-level ones for the same
  // lifecycle phase), matching the test plan's expectation that an
  // unauthenticated + CSRF-less request 401s rather than 403s.
  app.addHook('onRequest', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) {
      reply.code(401).send(GENERIC_NOT_AUTHENTICATED);
    }
  });

  app.get(
    '/warbands',
    { schema: { response: { 200: z.array(WarbandListItemSchema) } } },
    async (request) => {
      const userId = request.session.get('userId')!;
      const rows = await db.select().from(warbands).where(eq(warbands.userId, userId));
      return rows.map(serializeListItem);
    }
  );

  app.post(
    '/warbands',
    {
      onRequest: csrfProtection,
      schema: {
        body: WarbandSchema,
        response: { 201: WarbandDetailSchema, 400: ErrorSchema },
      },
    },
    async (request, reply) => {
      const userId = request.session.get('userId')!;
      const build = request.body;

      const unknownId = findUnknownContentId(build);
      if (unknownId) {
        reply.code(400);
        return { error: unknownId };
      }

      const [row] = await db
        .insert(warbands)
        .values({ userId, name: build.name, data: build })
        .returning();
      if (!row) throw new Error('warband insert returned no row');

      reply.code(201);
      return serializeDetail(row);
    }
  );

  app.get(
    '/warbands/:id',
    {
      schema: {
        params: IdParamsSchema,
        response: { 200: WarbandDetailSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const userId = request.session.get('userId')!;
      const { id } = request.params;

      const [row] = await db
        .select()
        .from(warbands)
        .where(and(eq(warbands.id, id), eq(warbands.userId, userId)));
      if (!row) {
        reply.code(404);
        return GENERIC_NOT_FOUND;
      }

      return serializeDetail(row);
    }
  );

  app.put(
    '/warbands/:id',
    {
      onRequest: csrfProtection,
      schema: {
        params: IdParamsSchema,
        body: WarbandSchema,
        response: { 200: WarbandDetailSchema, 400: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const userId = request.session.get('userId')!;
      const { id } = request.params;
      const build = request.body;

      const unknownId = findUnknownContentId(build);
      if (unknownId) {
        reply.code(400);
        return { error: unknownId };
      }

      // updatedAt must be set explicitly: drizzle's defaultNow() fires on
      // insert only, not on update.
      const [row] = await db
        .update(warbands)
        .set({ name: build.name, data: build, updatedAt: new Date() })
        .where(and(eq(warbands.id, id), eq(warbands.userId, userId)))
        .returning();
      if (!row) {
        reply.code(404);
        return GENERIC_NOT_FOUND;
      }

      return serializeDetail(row);
    }
  );

  app.delete(
    '/warbands/:id',
    { onRequest: csrfProtection, schema: { params: IdParamsSchema } },
    async (request, reply) => {
      const userId = request.session.get('userId')!;
      const { id } = request.params;

      const [row] = await db
        .delete(warbands)
        .where(and(eq(warbands.id, id), eq(warbands.userId, userId)))
        .returning({ id: warbands.id });
      if (!row) {
        reply.code(404);
        return GENERIC_NOT_FOUND;
      }

      // No response schema / body: avoid the serializer producing a body
      // for a 204.
      reply.code(204);
      return reply.send();
    }
  );
};

export default warbandRoutes;
