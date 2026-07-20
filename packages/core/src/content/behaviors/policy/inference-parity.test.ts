// The #66a/#66b parity contract: the committed inference-parity.fixture.json
// (67 observations recorded from the committed policy-smoke-v1.weights.json
// via export_policy.py, filtered to >= 0.01 argmax margin -- see
// gym/EXPORT.md's "TS mirror contract") must reproduce its committed
// `action` for every case when run through THIS module's inferActionComponents.
// JSON import only, no fs, so this stays scan-clean under
// content/behaviors/**.
import { describe, expect, it } from 'vitest';
import fixture from './inference-parity.fixture.json' with { type: 'json' };
import { computeActorLogits, inferActionComponents } from './inference.js';
import { policySmokeV1Weights } from './weights-schema.js';

describe('inference-parity fixture <-> weights consistency', () => {
  it('shares obsEncodingVersion, behaviorId, and obsDim with the weights module', () => {
    expect(fixture.obsEncodingVersion).toBe(policySmokeV1Weights.obsEncodingVersion);
    expect(fixture.behaviorId).toBe(policySmokeV1Weights.behaviorId);
    for (const testCase of fixture.cases) {
      expect(testCase.obs).toHaveLength(policySmokeV1Weights.obsDim);
    }
  });

  it('has the expected number of cases (67, per gym/EXPORT.md)', () => {
    expect(fixture.cases).toHaveLength(67);
  });
});

describe('inferActionComponents parity (argmax-level, per case)', () => {
  it.each(fixture.cases.map((testCase, index) => ({ ...testCase, index })))(
    'case $index: all 5 argmax components match the fixture action',
    ({ obs, action }) => {
      expect(inferActionComponents(policySmokeV1Weights, obs)).toEqual(action);
    },
  );
});

// A TS-only regression guard independent of the Python-generated fixture:
// exact float64 logits (not just the post-argmax action) for a couple of
// fixed observations, pinned as literal numbers. A future TS refactor that
// still passes every argmax case above but subtly perturbs the arithmetic
// (e.g. reordering a dot-product loop) would still be caught here. Only the
// `kind` (nvec[0]=5) and `skillIndex` (nvec[2]=6) segments are pinned, not
// the full 2014-wide flat vector (dominated by the two 1001-wide move_x/
// move_y segments) -- see nvec = [5, 1, 6, 1001, 1001].
const KIND_SEGMENT_END = 5;
const SKILL_SEGMENT_START = 6; // 5 (kind) + 1 (targetSlot)
const SKILL_SEGMENT_END = 12; // + 6 (skillIndex)

describe('computeActorLogits TS-only snapshot pin', () => {
  it.each([
    {
      caseIndex: 0,
      kindSegment: [
        -0.7956425340082667, -4.3760004877167145, 0.27164043813725863, 2.909092656590502,
        0.16255233559825155,
      ],
      skillSegment: [
        0.10929461134322398, 0.12062997882446085, 0.6320929435245306, -0.2645676833059662,
        -0.3706157640485674, -0.18882360062942738,
      ],
    },
    {
      caseIndex: 1,
      kindSegment: [
        -0.7929632891551721, -4.387833067106586, 0.2755625146389529, 2.912786358465943,
        0.16551721126212676,
      ],
      skillSegment: [
        0.11100143391796607, 0.12275023464126109, 0.6327926353719208, -0.2669168419497036,
        -0.37224643410500896, -0.18925946190272575,
      ],
    },
    {
      caseIndex: 34,
      kindSegment: [
        -0.793122596837268, -4.3867273061448575, 0.27606986629344465, 2.9128195990751906,
        0.16502054320644435,
      ],
      skillSegment: [
        0.11085774346076624, 0.12258251694465772, 0.6328848720474801, -0.2667867296375848,
        -0.3722418973185117, -0.18917144560577367,
      ],
    },
  ])('case $caseIndex: kind/skillIndex logit segments are bit-identical to the pin', ({
    caseIndex,
    kindSegment,
    skillSegment,
  }) => {
    const testCase = fixture.cases[caseIndex];
    if (testCase === undefined) throw new Error(`fixture case ${caseIndex} does not exist`);
    const logits = computeActorLogits(policySmokeV1Weights, testCase.obs);

    expect(logits.slice(0, KIND_SEGMENT_END)).toEqual(kindSegment);
    expect(logits.slice(SKILL_SEGMENT_START, SKILL_SEGMENT_END)).toEqual(skillSegment);
  });
});
