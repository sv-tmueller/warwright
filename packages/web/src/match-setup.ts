import type { Warband } from '@warwright/core';
import { findUnknownContentIds } from './warband-io.js';

// The player's choice for one side of the match, before it has been
// resolved into a concrete Warband. `upload` already carries the parsed,
// validated Warband (see the sub-plan on issue #93): validation happens
// once at import time (readWarbandFile), and the pending selection is kept
// so the same upload can be re-run with a different seed without
// re-uploading.
export type WarbandSource =
  | { readonly kind: 'sample'; readonly id: 'a' | 'b' }
  | { readonly kind: 'draft' }
  | { readonly kind: 'upload'; readonly warband: Warband; readonly fileName: string };

export type SeedParseResult = { readonly ok: true; readonly seed: number } | { readonly ok: false; readonly error: string };

// mulberry32 (packages/core/src/sim/prng.ts) does `a |= 0` on the seed, so
// any finite number is silently coerced to an int32 - a seed like 1e99 would
// "work" but not mean what it looks like it means, and could stop
// round-tripping faithfully through replay JSON. Number.isSafeInteger keeps
// every seed the viewer accepts exactly reproducible, and is strictly
// narrower than the CLI's Number.isInteger gate (packages/cli/src/index.ts),
// so every seed the viewer accepts the CLI accepts too.
export function parseSeed(raw: string): SeedParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, error: 'Seed is required.' };
  }
  const seed = Number(trimmed);
  if (!Number.isSafeInteger(seed)) {
    return { ok: false, error: `Seed must be a whole number, got "${raw}".` };
  }
  return { ok: true, seed };
}

export type SourceResolveResult =
  | { readonly ok: true; readonly warband: Warband }
  | { readonly ok: false; readonly error: string };

// The two bundled sample warbands and a way to read the builder's saved
// draft, injected so this module is testable without a DOM or localStorage
// (see persistence.ts's own storage-injection pattern). `loadDraft` is
// called fresh every time `resolveSource`/`resolveSetup` runs: the draft is
// snapshotted at Run-click time, never cached across calls.
export type ResolveSourceDeps = {
  readonly sampleA: Warband;
  readonly sampleB: Warband;
  readonly loadDraft: () => Warband | null;
};

function resolveDraft(deps: ResolveSourceDeps): SourceResolveResult {
  let draft: Warband | null;
  try {
    draft = deps.loadDraft();
  } catch (error) {
    return {
      ok: false,
      error: `Builder draft is corrupt: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (draft === null) {
    return { ok: false, error: 'No builder draft has been saved yet.' };
  }
  // localStorage is externally editable, so treat the draft as external
  // data (CLAUDE.md): run it through the same content-id check the upload
  // path uses (readWarbandFile in warband-io.ts).
  const unknownIds = findUnknownContentIds(draft);
  if (unknownIds.length > 0) {
    return { ok: false, error: `Builder draft has unknown content id(s): ${unknownIds.join('; ')}` };
  }
  return { ok: true, warband: draft };
}

export function resolveSource(source: WarbandSource, deps: ResolveSourceDeps): SourceResolveResult {
  switch (source.kind) {
    case 'sample':
      return { ok: true, warband: source.id === 'a' ? deps.sampleA : deps.sampleB };
    case 'upload':
      return { ok: true, warband: source.warband };
    case 'draft':
      return resolveDraft(deps);
  }
}

export type SetupResolveResult =
  | { readonly ok: true; readonly seed: number; readonly buildA: Warband; readonly buildB: Warband }
  | { readonly ok: false; readonly error: string };

// The single function the Run button calls: parses the seed, then resolves
// each side in order, reporting the first failure (seed, then side A, then
// side B) so the setup error always names the first thing to fix.
export function resolveSetup(
  seedRaw: string,
  sourceA: WarbandSource,
  sourceB: WarbandSource,
  deps: ResolveSourceDeps,
): SetupResolveResult {
  const seedResult = parseSeed(seedRaw);
  if (!seedResult.ok) {
    return { ok: false, error: seedResult.error };
  }

  const resultA = resolveSource(sourceA, deps);
  if (!resultA.ok) {
    return { ok: false, error: resultA.error };
  }

  const resultB = resolveSource(sourceB, deps);
  if (!resultB.ok) {
    return { ok: false, error: resultB.error };
  }

  return { ok: true, seed: seedResult.seed, buildA: resultA.warband, buildB: resultB.warband };
}
