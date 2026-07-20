import { pathToFileURL } from 'node:url';
import { validateSubmission } from './validate.js';
import type { ValidateReport } from './validate.js';

const USAGE =
  'Usage: foundry validate <submission-dir>  (the root `foundry:validate` pnpm script omits ' +
  'the "validate" token: `pnpm foundry:validate <submission-dir>`)';

// Accepts BOTH the documented "validate <dir>" grammar and a bare "<dir>"
// positional (an optional leading "validate" token is stripped if
// present): the root package.json script is `"foundry:validate": "tsx
// packages/foundry/src/cli.ts"`, so `pnpm foundry:validate <dir>` invokes
// this with argv = [<dir>], with no "validate" token of its own.
export function parseCliArgs(argv: readonly string[]): { dir: string } {
  const positional = argv[0] === 'validate' ? argv.slice(1) : argv;
  if (positional.length !== 1 || positional[0] === undefined) {
    throw new Error(`Unrecognized invocation.\n${USAGE}`);
  }
  return { dir: positional[0] };
}

/**
 * Renders a ValidateReport as the per-stage report cli.ts prints. A pass
 * shows every stage explicitly (1 and 2 are pass/fail gates with no
 * metric; 3 carries the measured gauntlet win rate against its calibrated
 * threshold -- see stage3.ts). A failure names the failing stage and
 * surfaces its full reason text.
 */
export function formatReport(report: ValidateReport): string {
  if (report.ok) {
    const { stage3 } = report;
    return [
      `PASS  ${report.submissionId}`,
      '  stage 1 (manifest + entry): pass',
      '  stage 2 (purity scan + run-twice idempotence): pass',
      `  stage 3 (seed gauntlet): pass -- win rate ${stage3.winRate} ` +
        `(${stage3.wins}/${stage3.total}), threshold ${stage3.threshold}`,
    ].join('\n');
  }

  return [
    `FAIL  ${report.submissionId}`,
    `  failed at stage ${report.stage}`,
    `  reason: ${report.reason}`,
  ].join('\n');
}

export async function main(): Promise<number> {
  const { dir } = parseCliArgs(process.argv.slice(2));
  const report = await validateSubmission(dir);
  console.log(formatReport(report));
  return report.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
