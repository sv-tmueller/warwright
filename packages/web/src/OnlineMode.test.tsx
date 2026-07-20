// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Mocks at the api-client module boundary (per the sub-plan on issue
// #116/batch #139): OnlineMode.tsx reaches the network only through these
// nine static named imports from './api-client.js', so this is the only seam
// that pins the PR #115 polling timer-leak fix with zero product-code
// change. `queueStatus` is the sole issuer of `GET /queue`, so "queueStatus
// call count" below stands in for "GET /queue call count".
vi.mock('./api-client.js', () => ({
  enqueue: vi.fn(),
  leaveQueue: vi.fn(),
  listWarbands: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
  queueStatus: vi.fn(),
  register: vi.fn(),
  saveWarband: vi.fn(),
}));

import {
  enqueue,
  leaveQueue,
  listWarbands,
  logout,
  me,
  queueStatus,
  type ApiResult,
  type EnqueueOutcome,
  type QueueStatus,
  type User,
  type WarbandListItem,
} from './api-client.js';
import { OnlineMode } from './OnlineMode.js';

function ok<T>(value: T): ApiResult<T> {
  return { ok: true, value };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const USER: User = { id: 'user-1', email: 'pilot@example.com' };
const WARBAND: WarbandListItem = {
  id: 'warband-1',
  name: 'Testing Warband',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

beforeEach(() => {
  // Vitest globals are off in this repo (per the sub-plan), so RTL's `act`
  // needs this set explicitly; without it, `act()` warns and batches
  // nothing.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // These are `vi.fn()`s from a `vi.mock()` factory, not `vi.spyOn()`
  // spies, so `afterEach`'s `vi.restoreAllMocks()` (a no-op restore-original
  // for non-spies) does not clear their call counts between tests; clear
  // explicitly so each test's `toHaveBeenCalledTimes` assertions start from
  // zero.
  vi.clearAllMocks();
  // Default fake-timer config: only timers are faked, microtasks (the
  // mocked api-client promises) stay real, so `await act(async () => {})`
  // alone flushes them.
  vi.useFakeTimers();
});

afterEach(() => {
  // RTL auto-cleanup doesn't register without the `vitest/globals` setup
  // this repo doesn't use, so cleanup is explicit here.
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Renders OnlineMode, signs it in, joins the queue with the one available
 * warband, and advances the fake 2s poll timer exactly once so a
 * `queueStatus()` poll is in flight (called once, its promise still
 * pending). Returns the deferred controlling that in-flight poll plus the
 * render result, so each test can cancel the loop a different way (unmount,
 * Leave queue, Log out) before resolving it and asserting no further
 * `GET /queue` call and no ownerless timer reschedule (the PR #115 fix).
 */
async function armInFlightPoll(): Promise<{
  renderResult: ReturnType<typeof render>;
  pollDeferred: ReturnType<typeof deferred<ApiResult<QueueStatus>>>;
}> {
  vi.mocked(me).mockResolvedValue(ok<User>(USER));
  vi.mocked(listWarbands).mockResolvedValue(ok<WarbandListItem[]>([WARBAND]));
  vi.mocked(enqueue).mockResolvedValue(ok<EnqueueOutcome>({ status: 'waiting' }));
  vi.mocked(leaveQueue).mockResolvedValue(ok<void>(undefined));
  vi.mocked(logout).mockResolvedValue(ok<{ ok: true }>({ ok: true }));

  const pollDeferred = deferred<ApiResult<QueueStatus>>();
  vi.mocked(queueStatus).mockReturnValue(pollDeferred.promise);

  const renderResult = render(<OnlineMode />);
  // Flushes the mount effect's `me()` -> `refreshWarbands()` chain.
  await act(async () => {});

  fireEvent.change(screen.getByLabelText('Selected warband'), {
    target: { value: WARBAND.id },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Join queue' }));
  // Flushes handleJoin's `await enqueue(...)`, which (given 'waiting') calls
  // schedulePoll() synchronously, arming one setTimeout(2000).
  await act(async () => {});

  expect(vi.getTimerCount()).toBe(1);

  // Fires the poll's setTimeout callback, which calls queueStatus() and then
  // suspends on the still-pending deferred.
  await act(() => vi.advanceTimersByTimeAsync(2000));

  expect(queueStatus).toHaveBeenCalledTimes(1);

  return { renderResult, pollDeferred };
}

describe('OnlineMode polling cancellation (pins the PR #115 timer-leak fix)', () => {
  it('unmounting while a poll is in flight issues no further GET /queue calls once it resolves', async () => {
    const { renderResult, pollDeferred } = await armInFlightPoll();

    renderResult.unmount();

    pollDeferred.resolve(ok<QueueStatus>({ status: 'waiting' }));
    await act(async () => {});

    expect(queueStatus).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(queueStatus).toHaveBeenCalledTimes(1);
  });

  it('clicking Leave queue while a poll is in flight issues no further GET /queue calls once it resolves', async () => {
    const { pollDeferred } = await armInFlightPoll();

    fireEvent.click(screen.getByRole('button', { name: 'Leave queue' }));
    // Flushes handleLeave's `await leaveQueue()`.
    await act(async () => {});

    pollDeferred.resolve(ok<QueueStatus>({ status: 'waiting' }));
    await act(async () => {});

    expect(queueStatus).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(queueStatus).toHaveBeenCalledTimes(1);
  });

  it('clicking Log out while a poll is in flight issues no further GET /queue calls once it resolves', async () => {
    const { pollDeferred } = await armInFlightPoll();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    // Flushes handleLogout's `await logout()`.
    await act(async () => {});

    pollDeferred.resolve(ok<QueueStatus>({ status: 'waiting' }));
    await act(async () => {});

    expect(queueStatus).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(queueStatus).toHaveBeenCalledTimes(1);
  });
});
