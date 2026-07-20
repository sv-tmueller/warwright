import fastifyRateLimit from '@fastify/rate-limit';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger, preHandlerHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { DEFAULT_RATING, ratings, warbands } from '../db/schema.js';
import { resolveMatch } from '../matches/resolve.js';
import { MatchResultResponseSchema } from '../matches/schemas.js';
import { applyMatchRatings } from '../ratings/service.js';
import { createQueueService, type Pairing, type QueueService, type Scheduler } from './service.js';

export interface QueueRoutesOptions {
  db: Database;
  queue?: QueueConfig;
}

/** Matchmaking batching-window config, threaded from BuildAppOptions.queue through to createQueueService. All fields optional: omitted ones fall back to createQueueService's own defaults (production timers, DEFAULT_QUEUE_WINDOW_MS/DEFAULT_QUEUE_MAX_POOL). */
export interface QueueConfig {
  windowMs?: number;
  maxPool?: number;
  scheduler?: Scheduler;
  /**
   * Test-only escape hatch: called once, synchronously, with the
   * QueueService instance this plugin registration creates. HTTP-level
   * tests (queue.test.ts) have no other way to await a pairing pass to
   * quiescence deterministically — Fastify's plugin encapsulation means a
   * decorator added inside this plugin isn't visible on the parent app
   * instance (see plugins/session.ts's fp() doc comment for the one case
   * that deliberately opts out of that), and a K-triggered pass never
   * touches the scheduler at all, so there's no other seam to hook. Never
   * read by any production route.
   */
  onQueueServiceCreated?: (queueService: QueueService) => void;
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

// Each pairing pass can run up to maxPool/2 full headless sims (see
// resolveMatch's doc comment on runMatch being CPU-bound) — capped well
// below the CSRF/auth-protected endpoints' looser limits so one client
// can't cheaply force repeated enqueue attempts. Since #108, POST no longer
// runs a sim resolution itself (that moved to the batching-window pass, off
// the request path entirely) — the limit still guards enqueue-spam (and the
// K-trigger's synchronous pool mutation) rather than direct sim cost.
const ENQUEUE_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const;

/**
 * Holds the QueueService instance the resolver closure needs to call back
 * into (completePairing/failPairing). Needed only because the resolver
 * must be constructed *before* createQueueService returns the instance it
 * refers to (createQueueService's own options require a resolver) — a
 * plain forward-reference box rather than a `let`, so the one-time
 * assignment below reads as what it is (never reassigned after that).
 */
interface QueueServiceBox {
  current?: QueueService;
}

/**
 * Resolves one pairing: calls resolveMatch, then completePairing on
 * success. MUST catch everything — this runs from inside a timer callback
 * (or a K-triggered pass, fired off from inside a synchronous enqueue()),
 * never from a request handler that could otherwise 500. An error here
 * calls failPairing (restoring both entries — see Pairing's doc comment)
 * and logs via app.log rather than throwing, since nothing is listening to
 * catch a rejection at this point.
 */
async function resolveOnePairing(
  log: FastifyBaseLogger,
  db: Database,
  queueServiceBox: QueueServiceBox,
  pairing: Pairing
): Promise<void> {
  const queueService = queueServiceBox.current!;
  let matchId: string;
  let result: Awaited<ReturnType<typeof resolveMatch>>['result'];
  try {
    ({ matchId, result } = await resolveMatch(db, {
      userAId: pairing.userAId,
      userBId: pairing.userBId,
      buildA: pairing.buildA,
      buildB: pairing.buildB,
    }));
    queueService.completePairing(pairing, matchId, result);
  } catch (error) {
    queueService.failPairing(pairing);
    log.error(
      { err: error, userAId: pairing.userAId, userBId: pairing.userBId },
      'resolveMatch failed during a batching-window pairing pass; both entries restored to the queue'
    );
    return;
  }

  // Rating is deliberately outside the resolve try/catch and in its own
  // try/catch: a failed rating write must never undo an already-completed,
  // already-persisted match or corrupt queue state (the pairing above has
  // already succeeded). A failure here leaves matches.rated_at null — an
  // auditable "never rated" marker, not silently swallowed.
  try {
    await applyMatchRatings(db, matchId);
  } catch (error) {
    log.error({ err: error, matchId }, 'applyMatchRatings failed; match left unrated');
  }
}

/**
 * The resolver callback injected into createQueueService(): invoked with
 * every pairing a pass produces, resolving them concurrently (each pairing
 * is independent — no shared queue-state mutation happens inside
 * resolveOnePairing beyond the already-synchronous completePairing/
 * failPairing calls). Never rejects: resolveOnePairing catches its own
 * errors, and QueueService's own runPass swallows any pass that manages to
 * escape anyway (defense in depth) — see queue/service.ts's doc comments on
 * why an unhandled rejection out of a timer callback must never happen.
 */
function createResolver(
  log: FastifyBaseLogger,
  db: Database,
  queueServiceBox: QueueServiceBox
): (pairings: Pairing[]) => Promise<void> {
  return async (pairings) => {
    await Promise.all(pairings.map((pairing) => resolveOnePairing(log, db, queueServiceBox, pairing)));
  };
}

/**
 * Registers /queue (POST enqueue, GET status, DELETE leave). Must be
 * registered after the session plugin, like warbandRoutes/authRoutes — see
 * their matching doc comments and src/app.ts's registration order.
 *
 * The queue itself is a single createQueueService() instance scoped to this
 * plugin registration (i.e. to one buildApp() call) — never module-level,
 * so independent test apps sharing one Postgres instance never share queue
 * state. See QueueService's own doc comment for the no-await
 * critical-section invariant enqueue()/the pairing pass depend on.
 *
 * Since #108: POST /queue never pairs inline. It always synchronously
 * enqueues the caller (202) or rejects a duplicate (409); pairing happens
 * later, off the request path, in a batching-window pass (a timer, or an
 * immediate pass when the pool hits `queue.maxPool`). Results are delivered
 * through the existing GET /queue poll — the same 'matched'/'waiting'/
 * 'idle' status contract as before, just never returned synchronously from
 * POST anymore.
 */
const queueRoutes: FastifyPluginAsyncZod<QueueRoutesOptions> = async (app, options) => {
  const { db, queue } = options;
  const queueServiceBox: QueueServiceBox = {};
  const queueService = createQueueService({
    resolver: createResolver(app.log, db, queueServiceBox),
    windowMs: queue?.windowMs,
    maxPool: queue?.maxPool,
    scheduler: queue?.scheduler,
  });
  queueServiceBox.current = queueService;
  queue?.onQueueServiceCreated?.(queueService);

  await app.register(fastifyRateLimit, { global: false });

  const csrfProtection: preHandlerHookHandler = (request, reply, done) =>
    app.csrfProtection(request, reply, done);

  app.addHook('onRequest', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) {
      reply.code(401).send(GENERIC_NOT_AUTHENTICATED);
    }
  });

  // Cancels any pending batching-window timer on clean shutdown, mirroring
  // the session pruner's onClose hook in plugins/session.ts — a live app
  // that never closes this hook would otherwise leave a dangling timer (and
  // in tests, keep the process/vitest alive after the suite finishes).
  app.addHook('onClose', () => {
    queueService.dispose();
  });

  app.post(
    '/queue',
    {
      onRequest: csrfProtection,
      config: { rateLimit: ENQUEUE_RATE_LIMIT },
      schema: {
        body: EnqueueBodySchema,
        response: {
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
      // reads above. See QueueService's doc comment. enqueue() never pairs
      // inline anymore (see this plugin's own doc comment) — it always
      // returns 'waiting' or 'already-queued'.
      const outcome = queueService.enqueue(userId, rating, warbandRow.data);

      if (outcome.status === 'already-queued') {
        reply.code(409);
        return GENERIC_ALREADY_QUEUED;
      }

      reply.code(202);
      return { status: 'waiting' as const };
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
