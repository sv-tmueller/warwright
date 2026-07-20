import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Behavior } from '@warwright/core';
import { checkRunTwiceIdempotence, scanSubmissionDirStatic } from './purity.js';
import { parseSubmissionManifest } from './manifest.js';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));
const SUBMISSIONS_DIR = fileURLToPath(new URL('../submissions/', import.meta.url));

const tempDirs: string[] = [];

function makeTempSubmissionDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-purity-'));
  tempDirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), contents, 'utf8');
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('scanSubmissionDirStatic (stage 2, static)', () => {
  it('rejects a submission that imports a forbidden Node module and uses Math.random', () => {
    const dir = path.join(FIXTURES_DIR, 'bad-import');

    expect(() => scanSubmissionDirStatic(dir)).toThrow(/stage 2 \(static/i);
  });

  it('rejects a submission whose relative import escapes its own directory', () => {
    const dir = makeTempSubmissionDir({
      'behavior.ts': `
        import type { Action, Behavior, UnitView, WorldView } from '@warwright/core';
        import { helper } from '../outside.js';
        function decide(self: UnitView, world: WorldView): Action {
          void helper;
          void self;
          void world;
          return { kind: 'idle' };
        }
        export const behavior: Behavior = { id: 'escaping', decide };
      `,
    });

    expect(() => scanSubmissionDirStatic(dir)).toThrow(/stage 2 \(static/i);
  });

  it('rejects a submission that imports a package other than @warwright/core', () => {
    const dir = makeTempSubmissionDir({
      'behavior.ts': `
        import lodash from 'lodash';
        void lodash;
      `,
    });

    expect(() => scanSubmissionDirStatic(dir)).toThrow(/stage 2 \(static/i);
  });

  it('accepts a pure sample that only imports @warwright/core', () => {
    expect(() => scanSubmissionDirStatic(path.join(SUBMISSIONS_DIR, 'sample-aggro'))).not.toThrow();
  });

  it('rejects a dynamic import(...) with a computed (non string-literal) specifier', () => {
    const dir = makeTempSubmissionDir({
      'behavior.ts': `
        const modulePath = 'node:fs';
        void import(modulePath);
      `,
    });

    expect(() => scanSubmissionDirStatic(dir)).toThrow(/stage 2 \(static/i);
  });

  it('rejects a dynamic import(...) built from a string-concatenation expression', () => {
    const dir = makeTempSubmissionDir({
      'behavior.ts': `
        void import('node:' + 'fs');
      `,
    });

    expect(() => scanSubmissionDirStatic(dir)).toThrow(/stage 2 \(static/i);
  });

  it('rejects a submission dir containing a stray non-.ts, non-manifest.json file', () => {
    const dir = makeTempSubmissionDir({
      'manifest.json': '{}',
      'behavior.ts': `
        import type { Action, Behavior, UnitView, WorldView } from '@warwright/core';
        function decide(self: UnitView, world: WorldView): Action {
          void self; void world;
          return { kind: 'idle' };
        }
        export const behavior: Behavior = { id: 'sneaky', decide };
      `,
      'helper.js': `module.exports = { evil: () => Math.random() };`,
    });

    expect(() => scanSubmissionDirStatic(dir)).toThrow(/stage 2 \(static/i);
  });
});

describe('checkRunTwiceIdempotence (stage 2, runtime)', () => {
  const manifest = parseSubmissionManifest('sample-aggro', {
    id: 'sample-aggro',
    author: 'foundry-fixtures',
    entry: 'behavior.ts',
    build: { roleId: 'reaver', skillIds: ['cleave'], position: { x: 0, y: 0 } },
    baseline: 'aggro-lowest-hp',
    shape: 'general',
  });

  function squaredDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  it('accepts a pure Behavior (identical hashes across two same-process runs)', () => {
    const pureBehavior: Behavior = {
      id: 'sample-aggro',
      decide: (self, world) => {
        const enemies = world.enemiesOf(self);
        const target = enemies[0];
        if (!target) return { kind: 'idle' };
        return squaredDistance(self.pos, target.pos) <= self.attackRangeSquared
          ? { kind: 'attack', targetId: target.id }
          : { kind: 'move-toward', targetId: target.id };
      },
    };

    expect(() => checkRunTwiceIdempotence(manifest, pureBehavior)).not.toThrow();
  });

  it('surfaces a decide() that throws mid-match as a clearly-attributed Stage 2 (runtime) error', () => {
    const throwingBehavior: Behavior = {
      id: 'sample-aggro',
      decide: () => {
        throw new Error('boom: submission decide() blew up');
      },
    };

    expect(() => checkRunTwiceIdempotence(manifest, throwingBehavior)).toThrow(
      /stage 2 \(runtime/i,
    );
  });

  it('rejects a Behavior with module-level mutable state (diverging hashes across two same-process runs)', () => {
    // Every third `decide` call idles instead of moving/attacking: harmless
    // within a single run, but the counter is NOT reset between the two
    // runMatchWithBehaviors calls below (same process, same closure), so the
    // second run's idle-tick pattern picks up where the first run left off
    // and its approach timing (hence every event after) diverges.
    let counter = 0;
    const statefulBehavior: Behavior = {
      id: 'sample-aggro',
      decide: (self, world) => {
        counter += 1;
        const enemies = world.enemiesOf(self);
        const target = enemies[0];
        if (!target) return { kind: 'idle' };
        if (counter % 3 === 0) return { kind: 'idle' };
        return squaredDistance(self.pos, target.pos) <= self.attackRangeSquared
          ? { kind: 'attack', targetId: target.id }
          : { kind: 'move-toward', targetId: target.id };
      },
    };

    expect(() => checkRunTwiceIdempotence(manifest, statefulBehavior)).toThrow(
      /stage 2 \(runtime/i,
    );
  });
});
