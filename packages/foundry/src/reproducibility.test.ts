import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSubmission } from './load.js';
import { runGauntlet } from './gauntlet.js';

const SUBMISSIONS_DIR = fileURLToPath(new URL('../submissions/', import.meta.url));

// Mirrors golden-replay's second assertion (see CLAUDE.md's determinism
// contract): the SAME seed set against the SAME baseline roster must
// produce byte-identical results every time. Runs the gauntlet end to end
// TWICE, from a freshly loaded submission each time, for both a
// rule-based ('general' shape) and an exported-policy ('1v1' shape)
// submission, so this catches a shape-specific regression either kind of
// submission could introduce.
describe('foundry gauntlet reproducibility', () => {
  it.each(['sample-aggro', 'sample-policy'])(
    'running the full gauntlet twice for %s yields identical win rates and identical per-match event-log hashes',
    async (submissionId) => {
      const dir = path.join(SUBMISSIONS_DIR, submissionId);

      const { manifest: firstManifest, behavior: firstBehavior } = await loadSubmission(dir);
      const first = runGauntlet(firstManifest, firstBehavior);

      const { manifest: secondManifest, behavior: secondBehavior } = await loadSubmission(dir);
      const second = runGauntlet(secondManifest, secondBehavior);

      expect(second.winRate).toBe(first.winRate);
      expect(second.wins).toBe(first.wins);
      expect(second.matches.map((m) => m.seed)).toEqual(first.matches.map((m) => m.seed));
      expect(second.matches.map((m) => m.winner)).toEqual(first.matches.map((m) => m.winner));
      expect(second.matches.map((m) => m.hash)).toEqual(first.matches.map((m) => m.hash));
    },
  );
});
