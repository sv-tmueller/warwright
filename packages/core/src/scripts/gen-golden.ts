// Regenerates packages/core/src/sim/__snapshots__/golden.json. This script
// lives outside sim/ (exempt from the sim/ ESLint override and the
// determinism-scan test, both of which are scoped to sim/) precisely because
// it needs node:fs to write the snapshot.
//
// Per the determinism contract in CLAUDE.md: only regenerate this snapshot
// because the sim's output is expected to change. If the sim's behavior
// changed intentionally, bump RULESET_VERSION in the same commit and note
// why the log changed.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RULESET_VERSION } from '../sim/constants.js';
import { runMatch } from '../sim/match.js';
import warbandA from '../../../../builds/warband-a.json' with { type: 'json' };
import warbandB from '../../../../builds/warband-b.json' with { type: 'json' };

const SEED = 42;

const result = runMatch({ version: RULESET_VERSION, seed: SEED, buildA: warbandA, buildB: warbandB });

const snapshot = { version: RULESET_VERSION, seed: SEED, hash: result.hash };

const outPath = fileURLToPath(new URL('../sim/__snapshots__/golden.json', import.meta.url));
writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');

console.log('Wrote', outPath, snapshot);
