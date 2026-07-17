import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

// Unit-tests session.ts's pruneSessionInterval option threading in
// isolation (no real Postgres): connect-pg-simple is mocked so we can
// capture the options its Store constructor receives, without needing a
// live pool or waiting out a real prune interval. See Finding 1 (PR #100
// round 1): pruneSessionInterval must default ON (not false) unless a
// caller (tests) explicitly opts out.

interface CapturedStoreOptions {
  pruneSessionInterval?: false | number;
}

// A mutable holder (rather than a bare reassigned `let`) so the value
// captured inside the mocked store's constructor below is reliably visible
// to the assertions, which run in a separate closure (each `it` block).
const captured: { options: CapturedStoreOptions | undefined } = { options: undefined };

// A function indirection, not a direct `captured.options` read: TS's control
// flow narrowing doesn't see that awaiting app.register()/app.ready() below
// reaches into the mocked store's constructor and reassigns
// `captured.options`, so it otherwise (incorrectly) keeps narrowing the
// property to the `undefined` set right after each test resets it.
function readCapturedOptions(): CapturedStoreOptions | undefined {
  return captured.options;
}

vi.mock('connect-pg-simple', () => {
  class FakeStore {
    constructor(options: CapturedStoreOptions) {
      captured.options = options;
    }
    close(): void {
      // no-op
    }
    get(_sid: string, callback: (error: unknown, session?: unknown) => void): void {
      callback(null, undefined);
    }
    set(_sid: string, _session: unknown, callback: (error?: unknown) => void): void {
      callback();
    }
    destroy(_sid: string, callback: (error?: unknown) => void): void {
      callback();
    }
  }
  return { default: () => FakeStore };
});

const { default: sessionPlugin } = await import('./session.js');

const SESSION_SECRET = 'a'.repeat(32);

describe('session plugin pruneSessionInterval threading (mocked store)', () => {
  it('defaults pruneSessionInterval to enabled (not false) when the option is omitted, as production does', async () => {
    captured.options = undefined;
    const app = Fastify();
    await app.register(sessionPlugin, {
      pool: {} as never,
      secret: SESSION_SECRET,
      cookieSecure: false,
    });
    await app.ready();

    expect(readCapturedOptions()?.pruneSessionInterval).not.toBe(false);

    await app.close();
  });

  it('disables pruneSessionInterval when explicitly passed false, as tests do', async () => {
    captured.options = undefined;
    const app = Fastify();
    await app.register(sessionPlugin, {
      pool: {} as never,
      secret: SESSION_SECRET,
      cookieSecure: false,
      pruneSessionInterval: false,
    });
    await app.ready();

    expect(readCapturedOptions()?.pruneSessionInterval).toBe(false);

    await app.close();
  });
});
