import { asc, desc } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { ratings } from '../db/schema.js';

export interface RatingRoutesOptions {
  db: Database;
}

const GENERIC_NOT_AUTHENTICATED = { error: 'Not authenticated' } as const;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const LeaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

const LeaderboardEntrySchema = z.object({
  userId: z.uuid(),
  rating: z.number(),
  ratingDeviation: z.number(),
  updatedAt: z.string(),
});

type RatingRow = typeof ratings.$inferSelect;

function serializeEntry(row: RatingRow) {
  return {
    userId: row.userId,
    rating: row.rating,
    ratingDeviation: row.ratingDeviation,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Registers GET /leaderboard: session-gated (same 401 onRequest hook
 * pattern as warbandRoutes/queueRoutes — see their matching comments), no
 * CSRF (a GET has none to check). Must be registered after the session
 * plugin, like warbandRoutes/queueRoutes; see src/app.ts's registration
 * order.
 *
 * Never returns email — userId is the only public identifier ratings
 * exposes (see #110 sub-plan's endpoint contract). Ordered by rating DESC,
 * user_id ASC so ties (including the shared DEFAULT_RATING before anyone's
 * first rated match) are stably ordered rather than depending on
 * unspecified row order.
 */
const ratingRoutes: FastifyPluginAsyncZod<RatingRoutesOptions> = async (app, options) => {
  const { db } = options;

  app.addHook('onRequest', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) {
      reply.code(401).send(GENERIC_NOT_AUTHENTICATED);
    }
  });

  app.get(
    '/leaderboard',
    {
      schema: {
        querystring: LeaderboardQuerySchema,
        response: { 200: z.array(LeaderboardEntrySchema) },
      },
    },
    async (request) => {
      const { limit } = request.query;
      const rows = await db
        .select()
        .from(ratings)
        .orderBy(desc(ratings.rating), asc(ratings.userId))
        .limit(limit);
      return rows.map(serializeEntry);
    }
  );
};

export default ratingRoutes;
