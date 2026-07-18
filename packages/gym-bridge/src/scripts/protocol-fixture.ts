// Pure generation logic for gym/tests/fixtures/protocol_golden.json, split
// out from gen-protocol-fixture.ts (which only adds the node:fs write) so
// the fixture can be re-derived in memory by protocol-fixture.test.ts --
// mirroring how packages/core/src/scripts/gen-golden.ts pairs with
// golden-replay.test.ts. Any encoder/catalog/layout change makes that
// vitest RED until this fixture is regenerated (`pnpm --filter
// @warwright/gym-bridge gen-fixture`) and the regen is a conscious,
// reviewed diff -- see the #63 review "lock the cross-language codec"
// finding.
import type { Action, Replay } from '@warwright/core';
import {
  OBS_ENCODING_VERSION,
  OBS_SELF_FIELD_COUNT,
  OBS_UNIT_FIELD_COUNT,
  createSteppedMatch,
  encodeAction,
  encodeObservation,
  skills,
} from '@warwright/core';

const replay: Replay = {
  version: 1,
  seed: 42,
  buildA: {
    name: 'Fixture A',
    units: [
      {
        roleId: 'vanguard',
        skillIds: ['shield-bash', 'guardian-ward'],
        behaviorId: 'protect-allies',
        position: { x: 100, y: 100 },
      },
      {
        roleId: 'reaver',
        skillIds: ['cleave'],
        behaviorId: 'aggro-lowest-hp',
        position: { x: 120, y: 100 },
      },
    ],
  },
  buildB: {
    name: 'Fixture B',
    units: [
      {
        roleId: 'mender',
        skillIds: ['mending-touch'],
        behaviorId: 'protect-allies',
        position: { x: 400, y: 100 },
      },
    ],
  },
};

export type ProtocolFixture = {
  obsEncodingVersion: number;
  skillCatalog: string[];
  skillCatalogLength: number;
  actions: Array<{ kind: string; action: Action; encoded: number[] }>;
  observation: {
    unitId: number;
    vector: number[];
    length: number;
  };
  selfFieldCount: number;
  unitFieldCount: number;
  numAllies: number;
  numEnemies: number;
};

// Re-derives the exact object gen-protocol-fixture.ts writes to
// gym/tests/fixtures/protocol_golden.json. Calling the same generation
// logic (not just re-invoking the script) is what lets
// protocol-fixture.test.ts assert deep-equality against the committed file
// without shelling out or touching the filesystem.
export function generateProtocolFixture(): ProtocolFixture {
  // step(0) advances nothing; it just returns the post-reset WorldState
  // through the public SteppedTransport surface (no internal `init` import).
  const transport = createSteppedMatch(replay);
  const world = transport.step(0);
  const vector = encodeObservation(world, 0);

  const actionCases: Array<{ kind: string; action: Action; encoded: number[] }> = [
    { kind: 'idle', action: { kind: 'idle' }, encoded: [] },
    { kind: 'move', action: { kind: 'move', to: { x: 12, y: 34 } }, encoded: [] },
    { kind: 'move-toward', action: { kind: 'move-toward', targetId: 7 }, encoded: [] },
    { kind: 'attack', action: { kind: 'attack', targetId: 3 }, encoded: [] },
    {
      kind: 'cast',
      action: { kind: 'cast', skillId: 'frost-bolt', targetId: 5 },
      encoded: [],
    },
  ];
  for (const testCase of actionCases) {
    testCase.encoded = encodeAction(testCase.action);
  }

  return {
    obsEncodingVersion: OBS_ENCODING_VERSION,
    skillCatalog: skills.map((skill) => skill.id),
    skillCatalogLength: skills.length,
    actions: actionCases,
    observation: {
      unitId: 0,
      vector,
      length: vector.length,
    },
    selfFieldCount: OBS_SELF_FIELD_COUNT,
    unitFieldCount: OBS_UNIT_FIELD_COUNT,
    numAllies: 1,
    numEnemies: 1,
  };
}
