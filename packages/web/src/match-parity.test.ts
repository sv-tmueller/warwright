import { describe, expect, it } from 'vitest';
import { RULESET_VERSION, parseWarband, runMatch } from '@warwright/core';
import warbandA from '../../../builds/warband-a.json' with { type: 'json' };
import warbandB from '../../../builds/warband-b.json' with { type: 'json' };
import warbandARaw from '../../../builds/warband-a.json?raw';
import warbandBRaw from '../../../builds/warband-b.json?raw';
import { runClientMatch } from './match-runner.js';

// Cross-surface parity (see CLAUDE.md): for a fixed seed and the same
// builds, the client, the core, and the CLI's load-and-run construction
// must produce the same winner and the same event-log hash.
const SEED = 42;

describe('cross-surface match parity', () => {
  it('produces the same winner and hash for the client, core, and CLI-construction legs', () => {
    const clientLeg = runClientMatch(SEED, warbandA, warbandB);

    // Core leg: same parsed JSON objects, driven straight through the
    // public core API instead of the client wrapper.
    const coreLeg = runMatch({
      version: RULESET_VERSION,
      seed: SEED,
      buildA: parseWarband(warbandA),
      buildB: parseWarband(warbandB),
    });

    // CLI-construction leg: mirrors packages/cli/src/index.ts's
    // loadWarband (readFileSync -> JSON.parse -> parseWarband), using
    // the `?raw` text of the same sample builds instead of node:fs.
    const cliLeg = runMatch({
      version: RULESET_VERSION,
      seed: SEED,
      buildA: parseWarband(JSON.parse(warbandARaw)),
      buildB: parseWarband(JSON.parse(warbandBRaw)),
    });

    expect(clientLeg.winner).toBe(coreLeg.winner);
    expect(clientLeg.hash).toBe(coreLeg.hash);
    expect(cliLeg.winner).toBe(coreLeg.winner);
    expect(cliLeg.hash).toBe(coreLeg.hash);
  });
});
