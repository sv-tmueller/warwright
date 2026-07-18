import fastifyRateLimit from '@fastify/rate-limit';
import { and, eq } from 'drizzle-orm';
import type { preHandlerHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { DEFAULT_RATING, ratings, warbands } from '../db/schema.js';
import { resolveMatch } from '../matches/resolve.js';
import { MatchResultResponseSchema } from '../matches/schemas.js';
import { applyMatchRatings } from '../ratings/service.js';
import { createQueueService } from './service.js';

export interface QueueRoutesOptions {
  db: Database;
}

const GENERIC_NOT_AUTHENTICATED = { error: 'Not authenticated' } as const;
const GENERIC_WARBAND_NOT_FOUND = { error: 'Warband not found' } as const;
const GENERIC_ALREADY_QUEUED = { error: 'Already queued' } as const;
const GENERIC_NOT_QUEUED = { error: 'Not queued' } as const;
const GENERIC_RESOLVING = { error: 'Match currently resolving' } as const;

const ErrorSchema = z.object({ error: z.string() });

const EnqueueBodySchema = z.object({ warbandId: z.uuid() });

const WaitingResponseSchema = z.object({ status: z.literal('waiting') });
const IdleResponseSchema = z.object({ status: z.literal('idle') });
const MatchedResponseSchema = z.object({
  status: z.literal('matched'),
  matchId: z.uuid(),
  result: MatchResultResponseSchema,
});

// Each pairing runs a full headless sim synchronously (see resolveMatch's
// doc comment on runMatch being CPU-bound) — capped well below the CSRF/
// auth-protected endpoints' looser limits so one client can't cheaply
// force repeated match resolutions.
const ENQUEUE_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const;

/**
 * Registers /queue (POST enqueue-and-maybe-pair, GET status, DELETE
 * leave). Must be registered after the session plugin, like
 * warbandRoutes/authRoutes — see their matching doc comments and src/
 * app.ts's registration order.
 *
 * The queue itself is a single createQueueService() instance scoped to
 * this plugin registration (i.e. to one buildApp() call) — never
 * module-level, so independent test apps sharing one Postgres instance
 * never share queue state. See QueueService's own doc comment for the
 * no-await critical-section invariant this route handler depends on:
 * every await below (session — via the onRequest hook, the warband fetch,
 * the rating read) happens before the single synchronous
 * queueService.enqueue() call; resolveMatch is awaited only after that
 * call has returned a 'paired' outcome, i.e. after both entries are
 * already synchronously removed from the waiting queue.
 */
const queueRoutes: FastifyPluginAsyncZod<QueueRoutesOptions> = async (app, options) => {
  const { db } = options;
  const queueService = createQueueService();

  await app.register(fastifyRateLimit, { global: false });

  const csrfProtection: preHandlerHookHandler = (request, reply, done) =>
    app.csrfProtection(request, reply, done);

  app.addHook('onRequest', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) {
      reply.code(401).send(GENERIC_NOT_AUTHENTICATED);
    }
  });

  app.post(
    '/queue',
    {
      onRequest: csrfProtection,
      config: { rateLimit: ENQUEUE_RATE_LIMIT },
      schema: {
        body: EnqueueBodySchema,
        response: {
          200: MatchedResponseSchema,
          202: WaitingResponseSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.session.get('userId')!;
      const { warbandId } = request.body;

      const [warbandRow] = await db
        .select()
        .from(warbands)
        .where(and(eq(warbands.id, warbandId), eq(warbands.userId, userId)));
      if (!warbandRow) {
        reply.code(404);
        return GENERIC_WARBAND_NOT_FOUND;
      }

      const [ratingRow] = await db.select().from(ratings).where(eq(ratings.userId, userId));
      const rating = ratingRow?.rating ?? DEFAULT_RATING;

      // Synchronous critical section: no await between this call and the
      // reads above. See QueueService's doc comment.
      const outcome = queueService.enqueue(userId, rating, warbandRow.data);

      if (outcome.status === 'already-queued') {
        reply.code(409);
        return GENERIC_ALREADY_QUEUED;
      }
      if (outcome.status === 'waiting') {
        reply.code(202);
        return { status: 'waiting' as const };
      }

      // Paired: resolveMatch is awaited only now, after both entries have
      // already been synchronously removed from the queue. Never forwards
      // a client-supplied seed or winner — resolveMatch draws its own
      // seed and computes its own winner.
      let matchId: string;
      let result: Awaited<ReturnType<typeof resolveMatch>>['result'];
      try {
        ({ matchId, result } = await resolveMatch(db, {
          userAId: outcome.pairing.userAId,
          userBId: outcome.pairing.userBId,
          buildA: outcome.pairing.buildA,
          buildB: outcome.pairing.buildB,
        }));
        queueService.completePairing(outcome.pairing, matchId, result);
      } catch (error) {
        queueService.failPairing(outcome.pairing);
        throw error;
      }

      // Rating is deliberately outside the resolve try/catch and in its own
      // try/catch: a failed rating write must never 500 an already-
      // completed, already-persisted match or corrupt queue state (the
      // pairing above has already succeeded). A failure here leaves
      // matches.rated_at null — an auditable "never rated" marker, not
      // silently swallowed. Respects the no-await invariant documented on
      // QueueService: this await happens after enqueue() has already
      // returned 'paired', same as resolveMatch above.
      try {
        await applyMatchRatings(db, matchId);
      } catch (error) {
        app.log.error({ err: error, matchId }, 'applyMatchRatings failed; match left unrated');
      }

      return { status: 'matched' as const, matchId, result };
    }
  );

  app.get(
    '/queue',
    {
      schema: {
        response: {
          200: z.union([MatchedResponseSchema, WaitingResponseSchema, IdleResponseSchema]),
        },
      },
    },
    async (request) => {
      const userId = request.session.get('userId')!;
      return queueService.getStatus(userId);
    }
  );

  app.delete(
    '/queue',
    // No response schema: mirrors warbandRoutes' DELETE (see its matching
    // comment) — a typed 204 response entry would need an explicit empty
    // body schema, and reply.send() with no args is how Fastify avoids
    // the serializer producing a body for a 204.
    { onRequest: csrfProtection },
    async (request, reply) => {
      const userId = request.session.get('userId')!;
      const outcome = queueService.dequeue(userId);

      if (outcome === 'removed') {
        reply.code(204);
        return reply.send();
      }
      if (outcome === 'resolving') {
        reply.code(409);
        return GENERIC_RESOLVING;
      }
      reply.code(404);
      return GENERIC_NOT_QUEUED;
    }
  );
};

export default queueRoutes;
