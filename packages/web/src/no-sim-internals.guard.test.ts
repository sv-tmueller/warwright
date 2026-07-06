import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Proves the packages/web override in the root eslint.config.js: the client
// may only import core's public API (bare `@warwright/core`), never its
// internal sim modules. The exports map already blocks deep subpaths at
// module-resolution time; this rule makes the policy explicit and also
// catches relative-path escapes the exports map cannot see.
//
// Uses the DOM URL global rather than node:url so this file needs no
// @types/node; web's tsconfig deliberately omits Node types.
function fileUrlToPath(url: URL): string {
  return decodeURIComponent(url.pathname);
}

const REPO_ROOT = fileUrlToPath(new URL('../../../', import.meta.url));
const ROOT_CONFIG = fileUrlToPath(new URL('../../../eslint.config.js', import.meta.url));
const VIRTUAL_FILE_PATH = fileUrlToPath(new URL('./__guard-fixture.ts', import.meta.url));

async function lint(code: string): Promise<ESLint.LintResult> {
  const eslint = new ESLint({ cwd: REPO_ROOT, overrideConfigFile: ROOT_CONFIG });
  const [result] = await eslint.lintText(code, { filePath: VIRTUAL_FILE_PATH });
  if (!result) {
    throw new Error('expected a lint result');
  }
  return result;
}

describe('no-sim-internals guard', () => {
  it('reports no-restricted-imports for a deep import into core internals', async () => {
    const result = await lint(
      "import { resolveAttack } from '@warwright/core/src/sim/resolve/combat.js';\n",
    );

    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('reports nothing for an import from the bare core package', async () => {
    const result = await lint(
      "import { RULESET_VERSION } from '@warwright/core';\nvoid RULESET_VERSION;\n",
    );

    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).not.toContain('no-restricted-imports');
  });
});
