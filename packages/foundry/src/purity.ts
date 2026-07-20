import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Behavior, Replay } from '@warwright/core';
import { RULESET_VERSION, runMatchWithBehaviors } from '@warwright/core';
import { findForbiddenTokenViolations } from '@warwright/core/purity-tokens';
import type { SubmissionManifest } from './manifest.js';

// A submission .ts file may import ONLY '@warwright/core' (the public API;
// no subpaths -- '@warwright/core/purity-tokens' and any other deep import
// stay foundry/core-internal tooling, never a submission's business) or a
// relative path that stays inside its own submission directory. Everything
// else -- other npm packages, absolute paths, `../` escapes above the
// submission root -- is rejected.
const CORE_SPECIFIER = '@warwright/core';

const MANIFEST_FILE_NAME = 'manifest.json';

// Every entry under a submission dir must be a directory, a .ts file, or
// manifest.json -- anything else (a sibling .js/.mjs helper, for instance)
// would bypass this static scan entirely (it only scans .ts source) and
// still be reachable at runtime via a relative import or the entry module,
// so it is rejected outright rather than silently skipped (Fix 2, review of
// PR #136). Symlinked files/dirs are rejected too: this walk never follows
// a symlink, so a submission cannot point a scanned-looking path at
// unscanned content living outside the submission dir.
function collectTsFilesRecursive(dir: string, violations: string[]): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      violations.push(`${full}: symlinks are not allowed in a submission directory`);
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...collectTsFilesRecursive(full, violations));
    } else if (entry.isFile()) {
      if (entry.name === MANIFEST_FILE_NAME) continue;
      if (full.endsWith('.ts')) {
        files.push(full);
      } else {
        violations.push(`${full}: only .ts files and manifest.json are allowed in a submission directory`);
      }
    }
  }
  return files;
}

// Matches the specifier of every static `import ... from '...'`,
// `export ... from '...'`, bare `import '...'`, and dynamic `import('...')`
// form. Deliberately simple (regex, not a full parser) to mirror
// determinism-scan.test.ts's own text-scan philosophy: a fast, exhaustive
// belt, not a compiler.
const IMPORT_SPECIFIER_RE =
  /(?:\bfrom\s+['"]([^'"]+)['"])|(?:^\s*import\s+['"]([^'"]+)['"])|(?:\bimport\(\s*['"]([^'"]+)['"]\s*\))/gm;

function extractImportSpecifiers(contents: string): string[] {
  const specifiers: string[] = [];
  for (const match of contents.matchAll(IMPORT_SPECIFIER_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function isAllowedImport(specifier: string, fileDir: string, submissionRoot: string): boolean {
  if (specifier === CORE_SPECIFIER) return true;
  if (!specifier.startsWith('.')) return false; // any other bare package specifier: rejected

  const resolved = path.resolve(fileDir, specifier);
  const relativeToRoot = path.relative(submissionRoot, resolved);
  return relativeToRoot !== '' && !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot);
}

// Every `import(...)` call site, whatever its argument looks like. Used to
// find dynamic imports whose specifier ISN'T a plain string literal (e.g.
// `import(v)`, `import('f' + 's')`, `import(getPath())`) -- those bypass
// the specifier-based allowlist above entirely, since there is no literal
// text to check, so any such call is rejected outright rather than
// silently let through (Fix 3, review of PR #136).
const DYNAMIC_IMPORT_CALL_RE = /\bimport\s*\(([^()]*)\)/g;
const STRING_LITERAL_ARG_RE = /^\s*['"][^'"]*['"]\s*$/;

function findDynamicImportViolations(contents: string, relativePath: string): string[] {
  const violations: string[] = [];
  for (const match of contents.matchAll(DYNAMIC_IMPORT_CALL_RE)) {
    const arg = match[1] ?? '';
    if (!STRING_LITERAL_ARG_RE.test(arg)) {
      violations.push(
        `${relativePath}: dynamic import(...) with a non string-literal specifier is not allowed`,
      );
    }
  }
  return violations;
}

/**
 * Stage 2, static half: recursively scans every .ts file under `dir` for
 * forbidden tokens (reusing core's purity-tokens.ts, the same list
 * determinism-scan.test.ts enforces on first-party code) and enforces the
 * import allowlist. Runs BEFORE the submission's entry is ever dynamically
 * imported (see load.ts) -- a submission whose forbidden import is a
 * literal, statically-visible specifier never executes. This is a text
 * scan, not a compiler: computed member access that isn't caught by these
 * regexes (e.g. `Math['random']`) could still slip through. Treat this gate
 * as a cooperative-CI check against accidental non-determinism, not a
 * hostile-input sandbox.
 */
export function scanSubmissionDirStatic(dir: string): void {
  const violations: string[] = [];
  const files = collectTsFilesRecursive(dir, violations);

  for (const file of files) {
    const contents = readFileSync(file, 'utf8');
    const relativePath = path.relative(dir, file);

    for (const reason of findForbiddenTokenViolations(contents)) {
      violations.push(`${relativePath}: ${reason}`);
    }

    for (const specifier of extractImportSpecifiers(contents)) {
      if (!isAllowedImport(specifier, path.dirname(file), dir)) {
        violations.push(`${relativePath}: disallowed import "${specifier}"`);
      }
    }

    violations.push(...findDynamicImportViolations(contents, relativePath));
  }

  if (violations.length > 0) {
    throw new Error(`Stage 2 (static scan) rejected submission:\n${violations.join('\n')}`);
  }
}

function representativeReplay(manifest: SubmissionManifest): Replay {
  return {
    version: RULESET_VERSION,
    seed: 1,
    buildA: {
      name: 'foundry-idempotence-a',
      units: [
        {
          roleId: manifest.build.roleId,
          skillIds: manifest.build.skillIds,
          behaviorId: manifest.id,
          position: manifest.build.position,
        },
      ],
    },
    buildB: {
      name: 'foundry-idempotence-b',
      units: [
        {
          roleId: 'mender',
          skillIds: [],
          behaviorId: manifest.baseline,
          position: { x: 500, y: 500 },
        },
      ],
    },
  };
}

/**
 * Stage 2, runtime half: runs one representative match TWICE in the SAME
 * process (a fresh process would reset module state and hide the bug) via
 * runMatchWithBehaviors, and requires identical event-log hashes. A
 * submission with module-level mutable state produces a divergent second
 * hash and is rejected.
 */
export function checkRunTwiceIdempotence(manifest: SubmissionManifest, behavior: Behavior): void {
  const replay = representativeReplay(manifest);

  const first = runMatchWithBehaviors(replay, [behavior]);
  const second = runMatchWithBehaviors(replay, [behavior]);

  if (first.hash !== second.hash) {
    throw new Error(
      `Stage 2 (runtime idempotence) rejected submission "${manifest.id}": running the ` +
        'same match twice in the same process produced different event-log hashes ' +
        `(${first.hash} vs ${second.hash}) -- likely module-level mutable state.`,
    );
  }
}
