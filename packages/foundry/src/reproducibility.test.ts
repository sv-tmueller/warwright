import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSubmission } from './load.js';
import { runGauntlet } from './gauntlet.js';

const SUBMISSIONS_DIR = fileURLToPath(new URL('../submissions/', import.meta.url));

// Mirrors golden-replay's second assertion (see CLAUDE.md's determinism
// contract): the SAME seed set against the SAME baseline roster must
// produce byte-identical results every time. Runs the gauntlet end to end
// TWICE, from a freshly loaded submission each time, for the committed
// rule-based ('general' shape) sample, so this catches a regression a
// submission could introduce.
//
// sample-aggro runs the full, default GAUNTLET_SEEDS (cheap: rule-based
// Behaviors have no per-tick inference cost).
const REPRODUCIBILITY_CASES = [{ submissionId: 'sample-aggro', seeds: undefined }] as const;

describe('foundry gauntlet reproducibility', () => {
  it.each(REPRODUCIBILITY_CASES)(
    'running the gauntlet twice for $submissionId yields identical win rates and identical per-match event-log hashes',
    async ({ submissionId, seeds }) => {
      const dir = path.join(SUBMISSIONS_DIR, submissionId);

      const { manifest: firstManifest, behavior: firstBehavior } = await loadSubmission(dir);
      const first = runGauntlet(firstManifest, firstBehavior, seeds);

      const { manifest: secondManifest, behavior: secondBehavior } = await loadSubmission(dir);
      const second = runGauntlet(secondManifest, secondBehavior, seeds);

      expect(second.winRate).toBe(first.winRate);
      expect(second.wins).toBe(first.wins);
      expect(second.matches.map((m) => m.seed)).toEqual(first.matches.map((m) => m.seed));
      expect(second.matches.map((m) => m.winner)).toEqual(first.matches.map((m) => m.winner));
      expect(second.matches.map((m) => m.hash)).toEqual(first.matches.map((m) => m.hash));
    },
  );
});
