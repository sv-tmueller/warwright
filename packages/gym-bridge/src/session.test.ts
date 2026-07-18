import { describe, expect, it } from 'vitest';
import { EXTERNAL_BEHAVIOR_ID, RULESET_VERSION, encodeAction, runMatch } from '@warwright/core';
import warbandA from '../../../builds/warband-a.json' with { type: 'json' };
import warbandB from '../../../builds/warband-b.json' with { type: 'json' };
import { createSession } from './session.js';

const SEED = 42;
// Safely above the core's internal MATCH_TICK_CAP (not part of the public
// API, so not imported here); step() self-caps, so any sufficiently large
// value drives a match to completion in one round trip.
const STEP_TICKS = 10_000;

function send(session: ReturnType<typeof createSession>, command: unknown): Record<string, unknown> {
  const response = session.handleLine(JSON.stringify(command));
  expect(response).not.toBeNull();
  return JSON.parse(response as string) as Record<string, unknown>;
}

describe('createSession', () => {
  it('drives the bridge protocol to a result matching direct runMatch (transport == core)', () => {
    const session = createSession();
    const replay = { version: RULESET_VERSION, seed: SEED, buildA: warbandA, buildB: warbandB };

    const resetResponse = send(session, { id: 1, cmd: 'reset', envs: [{ envId: 0, replay }] });
    expect(resetResponse.id).toBe(1);
    const resetEnvs = resetResponse.envs as Array<Record<string, unknown>>;
    expect(resetEnvs).toHaveLength(1);
    expect(resetEnvs[0]!.done).toBe(false);
    expect(resetEnvs[0]!.envId).toBe(0);

    const stepResponse = send(session, {
      id: 2,
      cmd: 'step',
      envs: [{ envId: 0, ticks: STEP_TICKS }],
    });
    expect(stepResponse.id).toBe(2);
    const stepEnvs = stepResponse.envs as Array<Record<string, unknown>>;
    expect(stepEnvs).toHaveLength(1);
    const frame = stepEnvs[0]!;
    expect(frame.done).toBe(true);

    const expected = runMatch({
      version: RULESET_VERSION,
      seed: SEED,
      buildA: warbandA,
      buildB: warbandB,
    });
    const result = frame.result as { winner: string; hash: number };
    expect(result.winner).toBe(expected.winner);
    expect(result.hash).toBe(expected.hash);
    expect(expected.hash).toBe(1754985129);
  });

  it('batches multiple envs in a single reset and a single step command', () => {
    const session = createSession();
    const replay = { version: RULESET_VERSION, seed: SEED, buildA: warbandA, buildB: warbandB };

    const resetResponse = send(session, {
      id: 1,
      cmd: 'reset',
      envs: [
        { envId: 0, replay },
        { envId: 1, replay },
      ],
    });
    const resetEnvs = resetResponse.envs as Array<Record<string, unknown>>;
    expect(resetEnvs.map((frame) => frame.envId)).toEqual([0, 1]);

    const stepResponse = send(session, {
      id: 2,
      cmd: 'step',
      envs: [
        { envId: 0, ticks: STEP_TICKS },
        { envId: 1, ticks: STEP_TICKS },
      ],
    });
    const stepEnvs = stepResponse.envs as Array<Record<string, unknown>>;
    expect(stepEnvs).toHaveLength(2);
    for (const frame of stepEnvs) {
      expect(frame.done).toBe(true);
    }
  });

  it('re-arms an existing envId when reset is called again for it', () => {
    const session = createSession();
    const replay = { version: RULESET_VERSION, seed: SEED, buildA: warbandA, buildB: warbandB };

    send(session, { id: 1, cmd: 'reset', envs: [{ envId: 0, replay }] });
    send(session, { id: 2, cmd: 'step', envs: [{ envId: 0, ticks: 5 }] });

    const secondReset = send(session, { id: 3, cmd: 'reset', envs: [{ envId: 0, replay }] });
    const envs = secondReset.envs as Array<Record<string, unknown>>;
    expect(envs[0]!.done).toBe(false);
  });

  it('reports an error (not a crash) when stepping an unknown envId', () => {
    const session = createSession();
    const response = send(session, {
      id: 1,
      cmd: 'step',
      envs: [{ envId: 999, ticks: 1 }],
    });
    expect(response.id).toBe(1);
    expect(typeof response.error).toBe('string');
    expect(response.error as string).toMatch(/999/);
  });

  it('encodes observations only for external units and decodes their actions via the core codec', () => {
    const session = createSession();
    const replay = {
      version: RULESET_VERSION,
      seed: SEED,
      buildA: {
        name: 'External A',
        units: [
          { roleId: 'reaver', skillIds: [], behaviorId: EXTERNAL_BEHAVIOR_ID, position: { x: 0, y: 0 } },
        ],
      },
      buildB: {
        name: 'Target B',
        units: [
          { roleId: 'mender', skillIds: [], behaviorId: 'protect-allies', position: { x: 10, y: 0 } },
        ],
      },
    };

    const resetResponse = send(session, { id: 1, cmd: 'reset', envs: [{ envId: 0, replay }] });
    const resetFrame = (resetResponse.envs as Array<Record<string, unknown>>)[0]!;
    const obs = resetFrame.obs as Record<string, number[]>;
    expect(Object.keys(obs)).toEqual(['0']);

    const encodedAttack = encodeAction({ kind: 'attack', targetId: 1 });
    const stepResponse = send(session, {
      id: 2,
      cmd: 'step',
      envs: [{ envId: 0, ticks: 1, actions: { '0': encodedAttack } }],
    });
    const stepFrame = (stepResponse.envs as Array<Record<string, unknown>>)[0]!;
    expect(stepFrame.done).toBe(false);
  });

  it('surfaces the core throw for a living external unit with no action entry as {id, error}', () => {
    const session = createSession();
    const replay = {
      version: RULESET_VERSION,
      seed: SEED,
      buildA: {
        name: 'External A',
        units: [
          { roleId: 'reaver', skillIds: [], behaviorId: EXTERNAL_BEHAVIOR_ID, position: { x: 0, y: 0 } },
        ],
      },
      buildB: {
        name: 'Target B',
        units: [
          { roleId: 'mender', skillIds: [], behaviorId: 'protect-allies', position: { x: 10, y: 0 } },
        ],
      },
    };

    send(session, { id: 1, cmd: 'reset', envs: [{ envId: 0, replay }] });
    const response = send(session, { id: 2, cmd: 'step', envs: [{ envId: 0, ticks: 1 }] });
    expect(response.id).toBe(2);
    expect(response.error as string).toMatch(/external/i);
  });

  it('returns an error frame with a null id for malformed JSON', () => {
    const session = createSession();
    const response = session.handleLine('{not json');
    expect(response).not.toBeNull();
    const parsed = JSON.parse(response as string) as Record<string, unknown>;
    expect(parsed.id).toBeNull();
    expect(typeof parsed.error).toBe('string');
  });

  it('returns an error frame preserving the id for a schema-invalid command', () => {
    const session = createSession();
    const response = session.handleLine(JSON.stringify({ id: 42, cmd: 'bogus' }));
    expect(response).not.toBeNull();
    const parsed = JSON.parse(response as string) as Record<string, unknown>;
    expect(parsed.id).toBe(42);
    expect(typeof parsed.error).toBe('string');
  });

  it('ignores blank lines', () => {
    const session = createSession();
    expect(session.handleLine('')).toBeNull();
    expect(session.handleLine('   ')).toBeNull();
    expect(session.isClosed()).toBe(false);
  });

  it('closes the session on a close command with no response line', () => {
    const session = createSession();
    expect(session.isClosed()).toBe(false);
    const response = session.handleLine(JSON.stringify({ cmd: 'close' }));
    expect(response).toBeNull();
    expect(session.isClosed()).toBe(true);
  });
});
