import { useState } from 'react';
import { parseWarband } from '@warwright/core';
import type { MatchEvent, Warband } from '@warwright/core';
import warbandAJson from '../../../builds/warband-a.json' with { type: 'json' };
import warbandBJson from '../../../builds/warband-b.json' with { type: 'json' };
import { runClientMatch } from './match-runner.js';
import { loadWarband } from './persistence.js';
import { resolveSetup, type ResolveSourceDeps, type WarbandSource } from './match-setup.js';
import { MatchSetup, type UploadedFile } from './MatchSetup.js';
import { MatchPlayback } from './MatchPlayback.js';
import { lastTickOf } from './playback.js';

const DEFAULT_SEED = '42';

// Parsed once at module scope (pure Zod validation, no DOM/localStorage
// access) so both the initial auto-run and every later Run-click resolve
// against the same validated sample objects.
const SAMPLE_A: Warband = parseWarband(warbandAJson);
const SAMPLE_B: Warband = parseWarband(warbandBJson);

const DEFAULT_SOURCE_A: WarbandSource = { kind: 'sample', id: 'a' };
const DEFAULT_SOURCE_B: WarbandSource = { kind: 'sample', id: 'b' };

type MatchState = {
  readonly key: number;
  readonly log: MatchEvent[];
  readonly lastTick: number;
  readonly buildAName: string;
  readonly buildBName: string;
};

function runMatchState(key: number, seed: number, buildA: Warband, buildB: Warband): MatchState {
  const { eventLog } = runClientMatch(seed, buildA, buildB);
  return {
    key,
    log: eventLog,
    lastTick: lastTickOf(eventLog),
    buildAName: buildA.name,
    buildBName: buildB.name,
  };
}

function resolveDeps(): ResolveSourceDeps {
  return { sampleA: SAMPLE_A, sampleB: SAMPLE_B, loadDraft: loadWarband };
}

/**
 * Owns match setup (seed, per-side source selection, uploads, the setup
 * error) and the currently loaded match, then hands the resolved match to
 * `MatchPlayback`, remounted via an incrementing `key` on every Run so a new
 * match always plays back from tick 0 with zero reducer changes (see the
 * sub-plan on issue #93). Auto-runs once on mount with the pre-#93 defaults
 * (seed 42, sample A vs sample B) so the Gate 1 DoD flow (#53) still starts
 * from a playable match; every later match only comes from an explicit Run.
 */
export function MatchViewer() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [sourceA, setSourceA] = useState<WarbandSource>(DEFAULT_SOURCE_A);
  const [sourceB, setSourceB] = useState<WarbandSource>(DEFAULT_SOURCE_B);
  const [uploadedA, setUploadedA] = useState<UploadedFile | null>(null);
  const [uploadedB, setUploadedB] = useState<UploadedFile | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchState>(() =>
    runMatchState(0, Number(DEFAULT_SEED), SAMPLE_A, SAMPLE_B),
  );

  function handleSourceChange(side: 'A' | 'B', source: WarbandSource): void {
    if (side === 'A') {
      setSourceA(source);
    } else {
      setSourceB(source);
    }
  }

  function handleUploadSuccess(side: 'A' | 'B', warband: Warband, fileName: string): void {
    const uploaded: UploadedFile = { warband, fileName };
    const source: WarbandSource = { kind: 'upload', warband, fileName };
    if (side === 'A') {
      setUploadedA(uploaded);
      setSourceA(source);
    } else {
      setUploadedB(uploaded);
      setSourceB(source);
    }
    setSetupError(null);
  }

  function handleRun(): void {
    const result = resolveSetup(seed, sourceA, sourceB, resolveDeps());
    if (!result.ok) {
      setSetupError(result.error);
      return;
    }
    setSetupError(null);
    setMatch((current) => runMatchState(current.key + 1, result.seed, result.buildA, result.buildB));
  }

  return (
    <>
      <MatchSetup
        seed={seed}
        onSeedChange={setSeed}
        sourceA={sourceA}
        sourceB={sourceB}
        uploadedA={uploadedA}
        uploadedB={uploadedB}
        onSourceChange={handleSourceChange}
        onUploadSuccess={handleUploadSuccess}
        onUploadError={setSetupError}
        sampleAName={SAMPLE_A.name}
        sampleBName={SAMPLE_B.name}
        error={setupError}
        onRun={handleRun}
      />
      <MatchPlayback
        key={match.key}
        log={match.log}
        lastTick={match.lastTick}
        buildAName={match.buildAName}
        buildBName={match.buildBName}
      />
    </>
  );
}
