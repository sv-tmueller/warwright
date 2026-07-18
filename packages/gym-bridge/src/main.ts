// Entry point spawned by the Python client (gym/warwright_gym/transport.py)
// as `node dist/main.js`. Thin stdin/stdout wiring only: batched NDJSON in
// on stdin, batched NDJSON out on stdout, one request/one response, flushed
// per line. All protocol logic lives in session.ts (see the module comment
// there) so it stays unit-testable without a subprocess.
import { createInterface } from 'node:readline';
import { createSession } from './session.js';

export async function main(): Promise<void> {
  const session = createSession();
  const rl = createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    const response = session.handleLine(line);
    if (response !== null) {
      process.stdout.write(response + '\n');
    }
    if (session.isClosed()) {
      break;
    }
  }

  rl.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
