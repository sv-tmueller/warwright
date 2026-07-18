import { randomInt } from 'node:crypto';
import { parseWarband, runMatch, RULESET_VERSION, type MatchResult } from '@warwright/core';
import type { Database } from '../db/client.js';
import { matches } from '../db/schema.js';

// mulberry32 seeds are uint32: [0, 2^32).
const SEED_EXCLUSIVE_MAX = 2 ** 32;

export interface ResolveMatchInput {
  userAId: string;
  userBId: string;
  /** Already-validated-elsewhere Warband JSON (e.g. a fetched saved warband); re-validated here regardless. */
  buildA: unknown;
  buildB: unknown;
  /** Defaults to a server-chosen CSPRNG seed when omitted. Must be an integer in [0, 2^32) when supplied. */
  seed?: number;
}

export interface ResolveMatchOutput {
  matchId: string;
  result: MatchResult;
}

function resolveSeed(seed: number | undefined): number {
  if (seed === undefined) {
    // A CSPRNG, not sim/'s mulberry32: choosing the seed at match creation
    // is server-side non-sim code (players must not predict the seed), and
    // the drawn value is persisted so replay {version, seed, buildA,
    // buildB} stays reproducible per the determinism contract.
    return randomInt(0, SEED_EXCLUSIVE_MAX);
  }
  if (!Number.isInteger(seed) || seed < 0 || seed >= SEED_EXCLUSIVE_MAX) {
    throw new Error(`seed must be an integer in [0, 2^32), got ${seed}`);
  }
  return seed;
}

/**
 * The authoritative match-resolution primitive: validates both build
 * snapshots, pins the current RULESET_VERSION, runs core's runMatch
 * unchanged, and persists one immutable row to `matches` — the snapshots
 * stored are the canonical parseWarband output, not the raw input, so later
 * edits to a source warband (see #56's PUT route) never affect a resolved
 * match. Resolution happens before the insert (a single statement, no
 * transaction needed), so a validation or seed failure persists nothing.
 *
 * No HTTP endpoint wraps this in this slice; a future queue endpoint
 * (Batch 4) calls it directly. Note runMatch is synchronous/CPU-bound and
 * will block the event loop for the duration of a call — fine for now, but
 * that caller should decide whether to run it inline or off a worker
 * thread.
 */
export async function resolveMatch(db: Database, input: ResolveMatchInput): Promise<ResolveMatchOutput> {
  const buildA = parseWarband(input.buildA);
  const buildB = parseWarband(input.buildB);
  const seed = resolveSeed(input.seed);

  const result = runMatch({ version: RULESET_VERSION, seed, buildA, buildB });

  const [row] = await db
    .insert(matches)
    .values({
      rulesetVersion: RULESET_VERSION,
      seed: BigInt(seed),
      userAId: input.userAId,
      userBId: input.userBId,
      buildA,
      buildB,
      winner: result.winner,
      resultHash: BigInt(result.hash),
    })
    .returning();
  if (!row) throw new Error('match insert returned no row');

  return { matchId: row.id, result };
}
