import { z } from 'zod';

// Shallow, server-local mirror of core's MatchResult, not a re-export of a
// core schema (core exports no MatchResultSchema — MatchResult is produced
// in-process by core's typed runMatch via resolveMatch, not external data;
// see the #57 sub-plan's endpoint-contract decision). eventLog entries are
// validated only as passthrough objects: their exact shape is core's
// MatchEvent union, an implementation detail this response contract
// intentionally doesn't duplicate.
//
// Shared by queue/routes.ts (the matched-response result) and
// matches/routes.ts (replay's result) so both surfaces serialize a
// MatchResult identically — extracted here per #111's sub-plan (a pure
// refactor out of queue/routes.ts, no behavior change).
export const MatchResultResponseSchema = z.object({
  version: z.number().int(),
  seed: z.number().int(),
  hash: z.number().int(),
  winner: z.enum(['A', 'B', 'draw']),
  eventLog: z.array(z.looseObject({})),
});
