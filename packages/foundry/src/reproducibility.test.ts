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
//
// sample-aggro runs the full, default GAUNTLET_SEEDS (cheap: rule-based
// Behaviors have no per-tick inference cost). sample-policy instead uses a
// small, explicit seed set: this test is proving determinism (byte-
// identical hashes across two independent runs), a property a handful of
// seeds demonstrates just as well as all 25 -- the full 25-seed bar itself
// is proven once, at full N, by validate.test.ts's sample-policy case (see
// its comment). Running the 25-seed gauntlet twice for sample-policy (50
// rounds of policy-smoke-v1 MLP inference) would be redundant CPU cost
// across the suite for no extra coverage.
const REPRODUCIBILITY_CASES = [
  { submissionId: 'sample-aggro', seeds: undefined },
  { submissionId: 'sample-policy', seeds: [1, 2, 3, 4, 5] },
] as const;

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
