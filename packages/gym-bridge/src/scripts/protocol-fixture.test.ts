// Locks the committed gym/tests/fixtures/protocol_golden.json against the
// live TS encoder (#63 review "the parity fixture is generate-only" MUST-FIX
// finding). Mirrors packages/core/src/sim/golden-replay.test.ts's pairing
// with gen-golden.ts: this test re-derives the fixture IN MEMORY (the same
// generateProtocolFixture() the gen-fixture script calls) and asserts
// deep-equality against the committed file, so any encoder, skill-catalog,
// or layout change makes this test RED until the fixture is regenerated
// (`pnpm --filter @warwright/gym-bridge gen-fixture`) and the regen is a
// conscious, reviewed diff.
import { describe, expect, it } from 'vitest';
import committedFixture from '../../../../gym/tests/fixtures/protocol_golden.json' with { type: 'json' };
import { generateProtocolFixture } from './protocol-fixture.js';

describe('protocol_golden.json', () => {
  it('matches the fixture the TS encoder generates right now', () => {
    const live = generateProtocolFixture();

    expect(live).toEqual(committedFixture);
  });
});
