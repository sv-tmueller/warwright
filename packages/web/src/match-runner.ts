import {
  RULESET_VERSION,
  parseWarband,
  runMatch,
  type MatchEvent,
  type Winner,
} from '@warwright/core';

export type ClientMatchResult = {
  winner: Winner;
  hash: number;
  eventLog: MatchEvent[];
};

// Mirrors the CLI's load-and-run path (see packages/cli/src/index.ts):
// parse each build, then run against the pinned ruleset version. Named
// runClientMatch (not runMatch) so it doesn't shadow the core export.
export function runClientMatch(
  seed: number,
  buildAJson: unknown,
  buildBJson: unknown,
): ClientMatchResult {
  const buildA = parseWarband(buildAJson);
  const buildB = parseWarband(buildBJson);

  const result = runMatch({ version: RULESET_VERSION, seed, buildA, buildB });

  return { winner: result.winner, hash: result.hash, eventLog: result.eventLog };
}
