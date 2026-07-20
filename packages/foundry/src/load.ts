import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Behavior } from '@warwright/core';
import { parseSubmissionManifest } from './manifest.js';
import type { SubmissionManifest } from './manifest.js';
import { scanSubmissionDirStatic } from './purity.js';

export type LoadedSubmission = {
  readonly manifest: SubmissionManifest;
  readonly behavior: Behavior;
};

function readManifestData(dir: string): unknown {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Stage 1 (manifest): not found: ${manifestPath}`);
  }

  const raw = readFileSync(manifestPath, 'utf8');
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Stage 1 (manifest): ${manifestPath} is not valid JSON (${String(error)})`, {
      cause: error,
    });
  }
}

function isBehaviorShaped(value: unknown, expectedId: string): value is Behavior {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id === expectedId &&
    typeof candidate.decide === 'function'
  );
}

function findBehaviorExport(mod: Record<string, unknown>, expectedId: string): Behavior | undefined {
  const candidates = [mod.default, ...Object.values(mod)];
  for (const candidate of candidates) {
    if (isBehaviorShaped(candidate, expectedId)) return candidate;
  }
  return undefined;
}

/**
 * Loads a submission end to end: stage 1 (locate + parse manifest.json),
 * then -- ONLY if stage 2's static scan passes -- stage 1's remaining step,
 * dynamic-importing the entry module and structurally checking it exports a
 * Behavior whose id matches the manifest. A forbidden-import submission
 * (stage 2 static) is therefore NEVER executed: its module code never runs.
 * (Stage 2's runtime idempotence check and stage 3 are the caller's
 * responsibility -- see purity.ts / stage3.ts / gate.ts -- since they need
 * the loaded Behavior, not just the manifest.)
 */
export async function loadSubmission(dir: string): Promise<LoadedSubmission> {
  const dirName = path.basename(dir);
  const manifest = parseSubmissionManifest(dirName, readManifestData(dir));

  scanSubmissionDirStatic(dir);

  const entryPath = path.join(dir, manifest.entry);
  if (!existsSync(entryPath)) {
    throw new Error(`Stage 1 (entry): not found: ${entryPath}`);
  }

  const mod = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>;
  const behavior = findBehaviorExport(mod, manifest.id);
  if (!behavior) {
    throw new Error(
      `Stage 1 (entry): "${manifest.entry}" does not export a Behavior with id ` +
        `"${manifest.id}" and a decide function`,
    );
  }

  return { manifest, behavior };
}
