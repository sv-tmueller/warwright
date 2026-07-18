import { describe, expect, it } from 'vitest';
import warbandAJson from '../../../builds/warband-a.json' with { type: 'json' };
import {
  ALREADY_QUEUED_ERROR,
  enqueue,
  leaveQueue,
  listWarbands,
  login,
  logout,
  me,
  queueStatus,
  register,
  saveWarband,
  type FetchFn,
} from './api-client.js';

type Call = { readonly url: string; readonly init: RequestInit | undefined };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

// A DI fake standing in for globalThis.fetch (see the sub-plan on issue #59:
// api-client.ts injects a fetch-typed function and never monkeypatches
// globals). `handler` maps a request URL to a canned Response; every call is
// recorded so tests can assert method/path/headers/body order.
function fakeFetch(handler: (call: Call) => Response): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  }) as FetchFn;
  return { fetchFn, calls };
}

function headerValue(call: Call, name: string): string | undefined {
  const headers = call.init?.headers as Record<string, string> | undefined;
  return headers?.[name];
}

describe('api-client: CSRF-per-mutation', () => {
  it('fetches a fresh CSRF token before a mutating call and sends it in csrf-token', async () => {
    const { fetchFn, calls } = fakeFetch((call) => {
      if (call.url === '/auth/csrf') return jsonResponse(200, { csrfToken: 'token-1' });
      if (call.url === '/auth/register') return jsonResponse(201, { id: 'u1', email: 'a@b.com' });
      throw new Error(`unexpected request: ${call.url}`);
    });

    const result = await register('a@b.com', 'password123', fetchFn);

    expect(result).toEqual({ ok: true, value: { id: 'u1', email: 'a@b.com' } });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('/auth/csrf');
    expect(calls[0]?.init?.credentials).toBe('include');
    expect(calls[1]?.url).toBe('/auth/register');
    expect(calls[1]?.init?.method).toBe('POST');
    expect(calls[1]?.init?.credentials).toBe('include');
    expect(headerValue(calls[1]!, 'csrf-token')).toBe('token-1');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      email: 'a@b.com',
      password: 'password123',
    });
  });

  it('fetches a NEW csrf token for every mutating request rather than reusing a cached one', async () => {
    let csrfCount = 0;
    const { fetchFn, calls } = fakeFetch((call) => {
      if (call.url === '/auth/csrf') {
        csrfCount += 1;
        return jsonResponse(200, { csrfToken: `token-${csrfCount}` });
      }
      if (call.url === '/auth/login') return jsonResponse(200, { id: 'u1', email: 'a@b.com' });
      if (call.url === '/auth/logout') return jsonResponse(200, { ok: true });
      throw new Error(`unexpected request: ${call.url}`);
    });

    await login('a@b.com', 'password123', fetchFn);
    await logout(fetchFn);

    // A caching bug would send 'token-1' twice; scripting the fake to rotate
    // the token on every /auth/csrf call proves each mutation fetched its
    // own fresh one (see the sub-plan's CSRF risk note on issue #59).
    const mutationCsrfHeaders = calls
      .filter((call) => call.url !== '/auth/csrf')
      .map((call) => headerValue(call, 'csrf-token'));
    expect(mutationCsrfHeaders).toEqual(['token-1', 'token-2']);
  });

  it('does not send a csrf-token header on a plain GET query', async () => {
    const { fetchFn, calls } = fakeFetch((call) => {
      if (call.url === '/auth/me') return jsonResponse(200, { id: 'u1', email: 'a@b.com' });
      throw new Error(`unexpected request: ${call.url}`);
    });

    await me(fetchFn);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/auth/me');
    expect(headerValue(calls[0]!, 'csrf-token')).toBeUndefined();
  });
});

describe('api-client: error surfacing', () => {
  it('surfaces the server error string for a non-2xx response', async () => {
    const { fetchFn } = fakeFetch((call) => {
      if (call.url === '/auth/csrf') return jsonResponse(200, { csrfToken: 'token-1' });
      if (call.url === '/auth/login') return jsonResponse(401, { error: 'Invalid credentials' });
      throw new Error(`unexpected request: ${call.url}`);
    });

    const result = await login('a@b.com', 'wrong-password', fetchFn);

    expect(result).toEqual({ ok: false, error: 'Invalid credentials' });
  });

  it('fails loud (ok:false, not a throw) when a 2xx body does not match the expected envelope', async () => {
    const { fetchFn } = fakeFetch((call) => {
      if (call.url === '/auth/me') return jsonResponse(200, { id: 'u1' });
      throw new Error(`unexpected request: ${call.url}`);
    });

    const result = await me(fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

describe('api-client: saveWarband validates before fetching', () => {
  it('refuses a structurally invalid build without ever calling fetch', async () => {
    const { fetchFn, calls } = fakeFetch(() => {
      throw new Error('fetch must not be called for an invalid build');
    });

    const result = await saveWarband({ name: '', units: [] }, fetchFn);

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses a build with an unknown content id without ever calling fetch', async () => {
    const { fetchFn, calls } = fakeFetch(() => {
      throw new Error('fetch must not be called for an unknown content id');
    });

    const badWarband = structuredClone(warbandAJson);
    badWarband.units[0]!.roleId = 'not-a-real-role';

    const result = await saveWarband(badWarband, fetchFn);

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('validates then POSTs a well-formed build', async () => {
    const { fetchFn, calls } = fakeFetch((call) => {
      if (call.url === '/auth/csrf') return jsonResponse(200, { csrfToken: 'token-1' });
      if (call.url === '/warbands') {
        return jsonResponse(201, {
          id: 'w1',
          name: warbandAJson.name,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          data: warbandAJson,
        });
      }
      throw new Error(`unexpected request: ${call.url}`);
    });

    const result = await saveWarband(warbandAJson, fetchFn);

    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.url)).toEqual(['/auth/csrf', '/warbands']);
    expect(calls[1]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual(warbandAJson);
  });
});

describe('api-client: queue', () => {
  it('enqueue returns a waiting outcome on 202', async () => {
    const { fetchFn } = fakeFetch((call) => {
      if (call.url === '/auth/csrf') return jsonResponse(200, { csrfToken: 'token-1' });
      if (call.url === '/queue') return jsonResponse(202, { status: 'waiting' });
      throw new Error(`unexpected request: ${call.url}`);
    });

    const result = await enqueue('w1', fetchFn);

    expect(result).toEqual({ ok: true, value: { status: 'waiting' } });
  });

  it('enqueue surfaces the exported ALREADY_QUEUED_ERROR string on a 409', async () => {
    const { fetchFn } = fakeFetch((call) => {
      if (call.url === '/auth/csrf') return jsonResponse(200, { csrfToken: 'token-1' });
      if (call.url === '/queue') return jsonResponse(409, { error: 'Already queued' });
      throw new Error(`unexpected request: ${call.url}`);
    });

    const result = await enqueue('w1', fetchFn);

    expect(result).toEqual({ ok: false, error: ALREADY_QUEUED_ERROR });
  });

  it('queueStatus parses a matched response and casts eventLog for the caller', async () => {
    const eventLog = [{ kind: 'tick', tick: 3 }];
    const { fetchFn } = fakeFetch((call) => {
      if (call.url === '/queue') {
        return jsonResponse(200, {
          status: 'matched',
          matchId: 'm1',
          result: { version: 1, seed: 42, hash: 7, winner: 'A', eventLog },
        });
      }
      throw new Error(`unexpected request: ${call.url}`);
    });

    const result = await queueStatus(fetchFn);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.status === 'matched') {
      expect(result.value.matchId).toBe('m1');
      expect(result.value.result.eventLog).toEqual(eventLog);
    } else {
      throw new Error('expected a matched status');
    }
  });

  it('leaveQueue succeeds on a 204 with no body', async () => {
    const { fetchFn, calls } = fakeFetch((call) => {
      if (call.url === '/auth/csrf') return jsonResponse(200, { csrfToken: 'token-1' });
      if (call.url === '/queue') return new Response(null, { status: 204 });
      throw new Error(`unexpected request: ${call.url}`);
    });

    const result = await leaveQueue(fetchFn);

    expect(result.ok).toBe(true);
    expect(calls[1]?.init?.method).toBe('DELETE');
  });
});

describe('api-client: listWarbands', () => {
  it('returns the parsed list on success', async () => {
    const items = [
      { id: 'w1', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const { fetchFn } = fakeFetch((call) => {
      if (call.url === '/warbands') return jsonResponse(200, items);
      throw new Error(`unexpected request: ${call.url}`);
    });

    const result = await listWarbands(fetchFn);

    expect(result).toEqual({ ok: true, value: items });
  });
});
