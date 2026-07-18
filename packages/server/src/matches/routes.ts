import fastifyRateLimit from '@fastify/rate-limit';
import { runMatch, RULESET_VERSION } from '@warwright/core';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { matches } from '../db/schema.js';
import { MatchResultResponseSchema } from './schemas.js';

export interface MatchRoutesOptions {
  db: Database;
}

const GENERIC_NOT_AUTHENTICATED = { error: 'Not authenticated' } as const;
const GENERIC_NOT_FOUND = { error: 'Match not found' } as const;

const ErrorSchema = z.object({ error: z.string() });

// The explicit refusal payload for a cross-ruleset-version replay/verify
// attempt (D5, load-bearing): core's runMatch does not dispatch on
// `version` — it only stamps the number into the match-start event — so
// "re-running under the recorded version" is only meaningful when
// row.rulesetVersion === RULESET_VERSION. This 409 is returned BEFORE any
// runMatch call; see the version check at the top of each handler below.
const VersionConflictSchema = z.object({
  error: z.string(),
  storedVersion: z.number().int(),
  currentVersion: z.number().int(),
});

const IdParamsSchema = z.object({ id: z.uuid() });

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

const HistoryItemSchema = z.object({
  id: z.uuid(),
  rulesetVersion: z.number().int(),
  seed: z.number().int(),
  side: z.enum(['A', 'B']),
  opponentUserId: z.uuid(),
  winner: z.enum(['A', 'B', 'draw']),
  resultHash: z.number().int(),
  createdAt: z.string(),
});

const ReplayResponseSchema = z.object({
  matchId: z.uuid(),
  result: MatchResultResponseSchema,
});

const VerifyResponseSchema = z.object({
  verified: z.boolean(),
  rulesetVersion: z.number().int(),
  storedHash: z.number().int(),
  recomputedHash: z.number().int(),
});

type MatchRow = typeof matches.$inferSelect;

function serializeHistoryItem(row: MatchRow, viewerId: string) {
  const side = row.userAId === viewerId ? ('A' as const) : ('B' as const);
  return {
    id: row.id,
    rulesetVersion: row.rulesetVersion,
    // seed/resultHash are bigint columns (mulberry32 seeds and core's
    // uint32 hash both exceed Postgres's int4 range); converted to plain
    // numbers only at this response boundary — both are uint32-safe.
    seed: Number(row.seed),
    side,
    opponentUserId: side === 'A' ? row.userBId : row.userAId,
    winner: row.winner as 'A' | 'B' | 'draw',
    resultHash: Number(row.resultHash),
    createdAt: row.createdAt.toISOString(),
  };
}

function versionConflict(row: MatchRow) {
  return {
    error: 'cannot verify across ruleset versions',
    storedVersion: row.rulesetVersion,
    currentVersion: RULESET_VERSION,
  };
}

// Each replay/verify call is a synchronous full sim re-run (like
// resolveMatch, CPU-bound and blocking) — capped at the same rate as the
// queue's ENQUEUE limit so a client can't cheaply force repeated
// resolutions. See queue/routes.ts's matching ENQUEUE_RATE_LIMIT comment.
const RERUN_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const;

/**
 * Registers GET /matches (history), GET /matches/:id/replay, and
 * GET /matches/:id/verify — all participants-only and session-gated via
 * the same onRequest 401 hook as warbandRoutes/queueRoutes/ratingRoutes;
 * see their matching doc comments and src/app.ts's registration order.
 * GETs need no CSRF check.
 *
 * Every SELECT is scoped `WHERE id = :id AND (user_a_id = :sessionUserId
 * OR user_b_id = :sessionUserId)`, so a foreign row and a nonexistent row
 * are indistinguishable by construction: both 404 (mirrors warbandRoutes'
 * ownership-scoping pattern for the two-participant case).
 *
 * replay/verify refuse a cross-ruleset-version match with 409 BEFORE ever
 * calling runMatch (see versionConflict's doc comment) — the refusal is an
 * explicit integer comparison against RULESET_VERSION, never "run it and
 * see if the hash differs."
 */
const matchRoutes: FastifyPluginAsyncZod<MatchRoutesOptions> = async (app, options) => {
  const { db } = options;

  await app.register(fastifyRateLimit, { global: false });

  app.addHook('onRequest', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) {
      reply.code(401).send(GENERIC_NOT_AUTHENTICATED);
    }
  });

  app.get(
    '/matches',
    {
      schema: {
        querystring: HistoryQuerySchema,
        response: { 200: z.array(HistoryItemSchema) },
      },
    },
    async (request) => {
      const userId = request.session.get('userId')!;
      const { limit } = request.query;

      const rows = await db
        .select()
        .from(matches)
        .where(or(eq(matches.userAId, userId), eq(matches.userBId, userId)))
        .orderBy(desc(matches.createdAt), asc(matches.id))
        .limit(limit);

      return rows.map((row) => serializeHistoryItem(row, userId));
    }
  );

  app.get(
    '/matches/:id/replay',
    {
      config: { rateLimit: RERUN_RATE_LIMIT },
      schema: {
        params: IdParamsSchema,
        response: { 200: ReplayResponseSchema, 404: ErrorSchema, 409: VersionConflictSchema },
      },
    },
    async (request, reply) => {
      const userId = request.session.get('userId')!;
      const { id } = request.params;

      const [row] = await db
        .select()
        .from(matches)
        .where(and(eq(matches.id, id), or(eq(matches.userAId, userId), eq(matches.userBId, userId))));
      if (!row) {
        reply.code(404);
        return GENERIC_NOT_FOUND;
      }

      if (row.rulesetVersion !== RULESET_VERSION) {
        reply.code(409);
        return versionConflict(row);
      }

      const rerun = runMatch({
        version: row.rulesetVersion,
        seed: Number(row.seed),
        buildA: row.buildA,
        buildB: row.buildB,
      });
      // Corruption/drift must fail loud, not silently serve a wrong replay.
      if (BigInt(rerun.hash) !== row.resultHash) {
        throw new Error(
          `replay hash mismatch for match ${row.id}: stored ${row.resultHash.toString()}, recomputed ${rerun.hash}`
        );
      }

      return { matchId: row.id, result: rerun };
    }
  );

  app.get(
    '/matches/:id/verify',
    {
      config: { rateLimit: RERUN_RATE_LIMIT },
      schema: {
        params: IdParamsSchema,
        response: { 200: VerifyResponseSchema, 404: ErrorSchema, 409: VersionConflictSchema },
      },
    },
    async (request, reply) => {
      const userId = request.session.get('userId')!;
      const { id } = request.params;

      const [row] = await db
        .select()
        .from(matches)
        .where(and(eq(matches.id, id), or(eq(matches.userAId, userId), eq(matches.userBId, userId))));
      if (!row) {
        reply.code(404);
        return GENERIC_NOT_FOUND;
      }

      if (row.rulesetVersion !== RULESET_VERSION) {
        reply.code(409);
        return versionConflict(row);
      }

      const rerun = runMatch({
        version: row.rulesetVersion,
        seed: Number(row.seed),
        buildA: row.buildA,
        buildB: row.buildB,
      });
      const recomputedHash = BigInt(rerun.hash);

      // verified: false is still a 200 — the check ran; the finding is the
      // payload, not an error response.
      return {
        verified: recomputedHash === row.resultHash,
        rulesetVersion: row.rulesetVersion,
        storedHash: Number(row.resultHash),
        recomputedHash: Number(recomputedHash),
      };
    }
  );
};

export default matchRoutes;
