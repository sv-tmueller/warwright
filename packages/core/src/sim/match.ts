import { MATCH_TICK_CAP } from './constants.js';
import { emit } from './events.js';
import { hashEventLog } from './hash.js';
import { init } from './init.js';
import { stepTick } from './loop.js';
import { createSeedRegistry } from './seed-registry.js';
import type { MatchResult, RunMatch, Winner } from './types.js';

export const runMatch: RunMatch = ({ version, seed, buildA, buildB }) => {
  const world = init(version, seed, buildA, buildB);
  const registry = createSeedRegistry();

  let winner: Winner | null = null;
  while (world.tick < MATCH_TICK_CAP) {
    winner = stepTick(world, registry);
    if (winner !== null) break;
  }

  const finalWinner: Winner = winner ?? 'draw';
  emit(world.eventLog, { kind: 'match-end', tick: world.tick, winner: finalWinner });

  const result: MatchResult = {
    version,
    seed,
    winner: finalWinner,
    eventLog: world.eventLog,
    hash: hashEventLog(world.eventLog),
  };
  return result;
};
