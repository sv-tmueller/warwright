import type { Replay, SteppedTransport } from '../api/seams.js';
import type { Action, Behavior } from './behavior.js';
import { EXTERNAL_BEHAVIOR_ID, MATCH_TICK_CAP } from './constants.js';
import { emit } from './events.js';
import { hashEventLog } from './hash.js';
import { initWithRegistry } from './init.js';
import { stepTick } from './loop.js';
import { createSeedRegistryWith } from './seed-registry.js';
import type { ContentRegistry } from '../content/registry.js';
import type { MatchResult, Winner, WorldState } from './types.js';

export { EXTERNAL_BEHAVIOR_ID };

// Thin stateful wrapper over init + stepTick implementing SteppedTransport
// (see api/seams.ts). runMatch (match.ts) is re-expressed as
// createSteppedMatch(replay).step(MATCH_TICK_CAP).result() over this same
// wrapper, so the two MUST stay bit-identical: the per-iteration guard here
// is the literal `while (world.tick < MATCH_TICK_CAP)` condition from the
// former runMatch, and finalize() is the former lines 19-28 of match.ts,
// moved verbatim and run EXACTLY ONCE.
//
// `extraBehaviors` (default []) is the #135 core seam: Behaviors registered
// into the SAME registry stepTick resolves against, in addition to the seed
// set, via createSeedRegistryWith. With the default empty array this is
// bit-identical to the former hardcoded createSeedRegistry() call (same
// Behaviors, same registry construction order), so runMatch/match.ts (which
// never passes extraBehaviors) is unaffected.
export function createSteppedMatch(
  replay: Replay,
  extraBehaviors: readonly Behavior[] = [],
): SteppedTransport {
  let world: WorldState;
  let registry: ContentRegistry;
  let winner: Winner | null;
  let finalResult: MatchResult | null;

  function resetFrom(nextReplay: Replay): WorldState {
    registry = createSeedRegistryWith(extraBehaviors);
    world = initWithRegistry(
      nextReplay.version,
      nextReplay.seed,
      nextReplay.buildA,
      nextReplay.buildB,
      registry,
    );
    winner = null;
    finalResult = null;
    return world;
  }

  function finalize(): void {
    if (finalResult !== null) return;

    const finalWinner: Winner = winner ?? 'draw';
    emit(world.eventLog, { kind: 'match-end', tick: world.tick, winner: finalWinner });

    finalResult = {
      version: world.version,
      seed: world.seed,
      winner: finalWinner,
      eventLog: world.eventLog,
      hash: hashEventLog(world.eventLog),
    };
  }

  resetFrom(replay);

  return {
    reset(nextReplay: Replay): WorldState {
      return resetFrom(nextReplay);
    },

    step(ticks: number, actions?: ReadonlyMap<number, Action>): WorldState {
      for (let i = 0; i < ticks; i += 1) {
        if (finalResult !== null || world.tick >= MATCH_TICK_CAP) break;

        winner = stepTick(world, registry, actions);
        if (winner !== null || world.tick >= MATCH_TICK_CAP) {
          finalize();
          break;
        }
      }
      return world;
    },

    done(): boolean {
      return finalResult !== null;
    },

    result(): MatchResult {
      if (finalResult === null) {
        throw new Error('createSteppedMatch: result() called before the match is done');
      }
      return finalResult;
    },
  };
}
