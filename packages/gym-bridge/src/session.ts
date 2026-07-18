// Batched NDJSON protocol session for the gym bridge (#63). Pure protocol
// logic, deliberately separated from main.ts's stdin/stdout wiring so it is
// directly unit-testable (feed lines in, read response lines out) without
// spawning a subprocess. Imports ONLY @warwright/core's public exports (see
// the no-sim-internals ESLint restriction in eslint.config.js) and never
// re-implements any rule: it decodes wire actions into the core's Action
// type, drives `SteppedTransport`, and re-encodes `WorldState` into
// observations, nothing more.
import { z } from 'zod';
import type { Action, MatchResult, Replay, SteppedTransport, WorldState } from '@warwright/core';
import {
  EXTERNAL_BEHAVIOR_ID,
  createSteppedMatch,
  decodeAction,
  encodeObservation,
} from '@warwright/core';

const ReplaySchema = z.strictObject({
  version: z.number().int(),
  seed: z.number().int(),
  buildA: z.unknown(),
  buildB: z.unknown(),
});

// A single encoded action tuple; observation.ts's decodeAction validates the
// exact shape (length 4, known kind code, etc.) and throws loud on
// mismatch, so this stays a loose array-of-numbers here.
const EncodedActionSchema = z.array(z.number());

const ResetEnvSchema = z.strictObject({
  envId: z.number().int(),
  replay: ReplaySchema,
});

const StepEnvSchema = z.strictObject({
  envId: z.number().int(),
  ticks: z.number().int().positive(),
  actions: z.record(z.string(), EncodedActionSchema).optional(),
});

const CommandIdSchema = z.union([z.string(), z.number()]);

const ResetCommandSchema = z.strictObject({
  id: CommandIdSchema,
  cmd: z.literal('reset'),
  envs: z.array(ResetEnvSchema).min(1),
});

const StepCommandSchema = z.strictObject({
  id: CommandIdSchema,
  cmd: z.literal('step'),
  envs: z.array(StepEnvSchema).min(1),
});

const CloseCommandSchema = z.strictObject({
  cmd: z.literal('close'),
});

const CommandSchema = z.discriminatedUnion('cmd', [
  ResetCommandSchema,
  StepCommandSchema,
  CloseCommandSchema,
]);

type ResetCommand = z.infer<typeof ResetCommandSchema>;
type StepCommand = z.infer<typeof StepCommandSchema>;

type EnvFrame = {
  envId: number;
  obs: Record<string, number[]>;
  done: boolean;
  result?: MatchResult;
};

export type Session = {
  // Processes one input line. Returns the NDJSON response line to write
  // (WITHOUT a trailing newline), or null when there is nothing to write
  // (a blank line, or the `close` command).
  handleLine(line: string): string | null;
  isClosed(): boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Best-effort `id` extraction from a raw (not-yet-validated) parsed line, so
// an error response can still be correlated to its request even when the
// command otherwise fails schema validation.
function extractId(raw: unknown): string | number | null {
  if (raw !== null && typeof raw === 'object' && 'id' in raw) {
    const id = (raw as Record<string, unknown>).id;
    if (typeof id === 'string' || typeof id === 'number') return id;
  }
  return null;
}

export function createSession(): Session {
  const envs = new Map<number, SteppedTransport>();
  let closed = false;

  function buildFrame(envId: number, transport: SteppedTransport, world: WorldState): EnvFrame {
    const obs: Record<string, number[]> = {};
    for (const unit of world.units) {
      if (unit.behaviorId === EXTERNAL_BEHAVIOR_ID) {
        obs[String(unit.id)] = encodeObservation(world, unit.id);
      }
    }
    const done = transport.done();
    return done
      ? { envId, obs, done, result: transport.result() }
      : { envId, obs, done };
  }

  function decodeActionsRecord(
    actions: Record<string, number[]> | undefined,
  ): ReadonlyMap<number, Action> | undefined {
    if (actions === undefined) return undefined;
    const decoded = new Map<number, Action>();
    for (const [key, encoded] of Object.entries(actions)) {
      const unitId = Number(key);
      if (!Number.isInteger(unitId)) {
        throw new Error(`step: actions key "${key}" is not an integer unit id`);
      }
      decoded.set(unitId, decodeAction(encoded));
    }
    return decoded;
  }

  function handleReset(command: ResetCommand): EnvFrame[] {
    return command.envs.map(({ envId, replay }) => {
      const transport = envs.get(envId) ?? createSteppedMatch(replay as Replay);
      const world = transport.reset(replay as Replay);
      envs.set(envId, transport);
      return buildFrame(envId, transport, world);
    });
  }

  function handleStep(command: StepCommand): EnvFrame[] {
    return command.envs.map(({ envId, ticks, actions }) => {
      const transport = envs.get(envId);
      if (transport === undefined) {
        throw new Error(`step: unknown envId ${envId}; call reset before stepping it`);
      }
      const world = transport.step(ticks, decodeActionsRecord(actions));
      return buildFrame(envId, transport, world);
    });
  }

  function handleLine(line: string): string | null {
    const trimmed = line.trim();
    if (trimmed === '') return null;

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      return JSON.stringify({ id: null, error: `invalid JSON: ${errorMessage(error)}` });
    }

    const parsed = CommandSchema.safeParse(raw);
    if (!parsed.success) {
      return JSON.stringify({
        id: extractId(raw),
        error: `invalid command: ${z.prettifyError(parsed.error)}`,
      });
    }

    const command = parsed.data;
    if (command.cmd === 'close') {
      envs.clear();
      closed = true;
      return null;
    }

    try {
      const responseEnvs = command.cmd === 'reset' ? handleReset(command) : handleStep(command);
      return JSON.stringify({ id: command.id, envs: responseEnvs });
    } catch (error) {
      return JSON.stringify({ id: command.id, error: errorMessage(error) });
    }
  }

  return {
    handleLine,
    isClosed: () => closed,
  };
}
