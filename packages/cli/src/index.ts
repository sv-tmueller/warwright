import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { RULESET_VERSION, parseWarband, runMatch } from '@warwright/core';
import { formatEventLog } from './format.js';

const USAGE =
  'Usage: sim:run --seed <integer> --a <path/to/warband.json> --b <path/to/warband.json>';

export function parseArgs(argv: readonly string[]): {
  seed: number;
  buildAPath: string;
  buildBPath: string;
} {
  let seedRaw: string | undefined;
  let buildAPath: string | undefined;
  let buildBPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--seed') {
      seedRaw = value;
      i += 1;
    } else if (flag === '--a') {
      buildAPath = value;
      i += 1;
    } else if (flag === '--b') {
      buildBPath = value;
      i += 1;
    }
  }

  if (seedRaw === undefined || buildAPath === undefined || buildBPath === undefined) {
    throw new Error(`Missing required argument.\n${USAGE}`);
  }

  const seed = Number(seedRaw);
  if (!Number.isInteger(seed)) {
    throw new Error(`--seed must be an integer, got "${seedRaw}".\n${USAGE}`);
  }

  return { seed, buildAPath, buildBPath };
}

export function loadWarband(path: string): unknown {
  try {
    const raw = readFileSync(path, 'utf8');
    return parseWarband(JSON.parse(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load warband from "${path}": ${message}`, { cause: error });
  }
}

export function main(): void {
  const { seed, buildAPath, buildBPath } = parseArgs(process.argv.slice(2));
  const buildA = loadWarband(buildAPath);
  const buildB = loadWarband(buildBPath);

  const result = runMatch({ version: RULESET_VERSION, seed, buildA, buildB });

  for (const line of formatEventLog(result.eventLog)) {
    console.log(line);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
