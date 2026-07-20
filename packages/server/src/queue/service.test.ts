import { describe, expect, it, vi } from 'vitest';
import { createManualScheduler, createQueueService, selectOpponent, type Pairing, type WaitingEntry } from './service.js';

function entry(overrides: Partial<WaitingEntry> = {}): WaitingEntry {
  return {
    userId: 'user-default',
    rating: 1500,
    build: { name: 'default' },
    enqueuedAt: 0,
    ...overrides,
  };
}

/** A resolver stub that resolves immediately and records every pass it was handed. */
function recordingResolver() {
  const calls: Pairing[][] = [];
  const resolver = vi.fn(async (pairings: Pairing[]) => {
    calls.push(pairings);
  });
  return { resolver, calls };
}

describe('selectOpponent', () => {
  it('returns undefined when there are no candidates', () => {
    expect(selectOpponent([], 'me', 1500)).toBeUndefined();
  });

  it('excludes the caller even when they are the only candidate', () => {
    const candidates = [entry({ userId: 'me', rating: 1500, enqueuedAt: 1 })];
    expect(selectOpponent(candidates, 'me', 1500)).toBeUndefined();
  });

  it('picks the candidate with the nearest rating', () => {
    const near = entry({ userId: 'near', rating: 1550, enqueuedAt: 1 });
    const far = entry({ userId: 'far', rating: 1800, enqueuedAt: 2 });
    const candidates = [far, near];
    expect(selectOpponent(candidates, 'me', 1500)).toBe(near);
  });

  it('breaks a rating tie by earliest enqueuedAt (FIFO)', () => {
    const later = entry({ userId: 'later', rating: 1600, enqueuedAt: 5 });
    const earlier = entry({ userId: 'earlier', rating: 1400, enqueuedAt: 2 });
    // Both are exactly 100 away from 1500.
    const candidates = [later, earlier];
    expect(selectOpponent(candidates, 'me', 1500)).toBe(earlier);
  });

  it('excludes the caller from the candidate pool, picking the next-nearest', () => {
    const self = entry({ userId: 'me', rating: 1501, enqueuedAt: 1 });
    const other = entry({ userId: 'other', rating: 1600, enqueuedAt: 2 });
    const candidates = [self, other];
    expect(selectOpponent(candidates, 'me', 1500)).toBe(other);
  });

  it('picks Q (1600) over P (1200) for a joiner at the lazy default 1500 (the #57 sub-plan example)', () => {
    const p = entry({ userId: 'p', rating: 1200, enqueuedAt: 1 });
    const q = entry({ userId: 'q', rating: 1600, enqueuedAt: 2 });
    const candidates = [p, q];
    expect(selectOpponent(candidates, 'r', 1500)).toBe(q);
  });
});

describe('QueueService', () => {
  it('enqueues a lone player as waiting, and reports waiting on GET', () => {
    const { resolver } = recordingResolver();
    const service = createQueueService({ resolver, scheduler: createManualScheduler() });
    const outcome = service.enqueue('a', 1500, { name: 'A' });
    expect(outcome).toEqual({ status: 'waiting' });
    expect(service.getStatus('a')).toEqual({ status: 'waiting' });
  });

  it('reports idle for a user who never queued', () => {
    const { resolver } = recordingResolver();
    const service = createQueueService({ resolver, scheduler: createManualScheduler() });
    expect(service.getStatus('nobody')).toEqual({ status: 'idle' });
  });

  it('always returns waiting for a second distinct enqueue too: no inline pairing (the #108 policy change)', () => {
    const { resolver } = recordingResolver();
    const scheduler = createManualScheduler();
    const service = createQueueService({ resolver, scheduler, windowMs: 5000, maxPool: 8 });
    service.enqueue('a', 1500, { name: 'A' });
    const outcome = service.enqueue('b', 1520, { name: 'B' });

    expect(outcome).toEqual({ status: 'waiting' });
    // Still waiting, not resolving: the pass hasn't run yet.
    expect(service.getStatus('a')).toEqual({ status: 'waiting' });
    expect(service.getStatus('b')).toEqual({ status: 'waiting' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects a double-enqueue from the same waiting user with an already-queued status (409 source)', () => {
    const { resolver } = recordingResolver();
    const service = createQueueService({ resolver, scheduler: createManualScheduler() });
    service.enqueue('a', 1500, { name: 'A' });
    const second = service.enqueue('a', 1500, { name: 'A again' });
    expect(second).toEqual({ status: 'already-queued' });
  });

  it('retains a matched result until claimed, and clears it on the next enqueue', async () => {
    const { resolver, calls } = recordingResolver();
    const scheduler = createManualScheduler();
    const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });
    service.enqueue('a', 1500, { name: 'A' });
    service.enqueue('b', 1500, { name: 'B' });

    await scheduler.fire();
    expect(calls).toHaveLength(1);
    const [pairing] = calls[0]!;
    const result = { version: 2, seed: 1, winner: 'A' as const, eventLog: [], hash: 123 };
    service.completePairing(pairing!, 'match-1', result);

    // Retained across repeated GETs.
    expect(service.getStatus('a')).toEqual({ status: 'matched', matchId: 'match-1', result });
    expect(service.getStatus('a')).toEqual({ status: 'matched', matchId: 'match-1', result });
    expect(service.getStatus('b')).toEqual({ status: 'matched', matchId: 'match-1', result });

    // A new enqueue clears the stale unclaimed result.
    service.enqueue('a', 1500, { name: 'A' });
    expect(service.getStatus('a')).toEqual({ status: 'waiting' });
  });

  describe('pairing pass', () => {
    it('sorts the pool FIFO by enqueuedAt and pairs the oldest entry first via the unchanged selectOpponent', async () => {
      const { resolver, calls } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });

      // Enqueue order deliberately doesn't match rating-nearness order.
      service.enqueue('q', 1600, { name: 'Q' }); // oldest
      service.enqueue('p', 1200, { name: 'P' });
      service.enqueue('r', 1500, { name: 'R' }); // nearest to Q's 1600? no: |1600-1500|=100 vs |1600-1200|=400

      await scheduler.fire();

      expect(calls).toHaveLength(1);
      const pairings = calls[0]!;
      expect(pairings).toHaveLength(1);
      // Oldest (q) picks nearest rating among {p, r}: r (1500, diff 100) over p (1200, diff 400).
      expect(pairings[0]!.userAId).toBe('q');
      expect(pairings[0]!.userBId).toBe('r');
      // Leftover p stays waiting.
      expect(service.getStatus('p')).toEqual({ status: 'waiting' });
    });

    it('pairs a pool of 4 into exactly two pairings in one pass, oldest-first repeatedly', async () => {
      const { resolver, calls } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });

      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1510, { name: 'B' });
      service.enqueue('c', 1490, { name: 'C' });
      service.enqueue('d', 1505, { name: 'D' });

      await scheduler.fire();

      expect(calls).toHaveLength(1);
      const pairings = calls[0]!;
      expect(pairings).toHaveLength(2);

      const paired = new Set<string>();
      for (const pairing of pairings) {
        expect(paired.has(pairing.userAId)).toBe(false);
        expect(paired.has(pairing.userBId)).toBe(false);
        paired.add(pairing.userAId);
        paired.add(pairing.userBId);
      }
      expect(paired).toEqual(new Set(['a', 'b', 'c', 'd']));

      // No leftovers, nobody double-booked: every user is now resolving
      // (getStatus reports 'waiting' for both waiting and resolving users —
      // dequeue() is what distinguishes them, per its own doc comment).
      for (const id of ['a', 'b', 'c', 'd']) {
        expect(service.dequeue(id)).toBe('resolving');
      }
    });

    it('leaves an odd leftover waiting after a pass over an odd-sized pool', async () => {
      const { resolver, calls } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });

      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1510, { name: 'B' });
      service.enqueue('c', 1490, { name: 'C' });

      await scheduler.fire();

      expect(calls).toHaveLength(1);
      expect(calls[0]).toHaveLength(1);
      const dequeueOutcomes = ['a', 'b', 'c'].map((id) => service.dequeue(id));
      expect(dequeueOutcomes.filter((outcome) => outcome === 'removed')).toHaveLength(1);
      expect(dequeueOutcomes.filter((outcome) => outcome === 'resolving')).toHaveLength(2);
    });

    it('pins the FIFO-by-enqueuedAt sort against Map iteration order: a failPairing restore re-pairs the oldest entry, not the head of the re-inserted Map', async () => {
      const { resolver, calls } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });

      // enqueuedAt order: a (oldest), b, c. Ratings are chosen so pass 1
      // pairs a-b (nearest to a), leaving c waiting.
      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1510, { name: 'B' });
      service.enqueue('c', 1000, { name: 'C' });

      await scheduler.fire();
      expect(calls).toHaveLength(1);
      const [firstPairing] = calls[0]!;
      expect(firstPairing!.userAId).toBe('a');
      expect(firstPairing!.userBId).toBe('b');
      expect(service.getStatus('c')).toEqual({ status: 'waiting' });

      // Simulate the resolver failing this pairing: both a and b are
      // restored via Map.set, landing *after* c in Map iteration order
      // (c, a, b) even though enqueuedAt order is still a, b, c.
      service.failPairing(firstPairing!);
      expect(scheduler.pending).toBe(true); // pool of 3 is pairable again

      await scheduler.fire();
      expect(calls).toHaveLength(2);
      const [secondPairing] = calls[1]!;
      // The pass must pick the oldest entry by enqueuedAt ('a'), not the
      // Map-iteration-order head ('c'): without the collectPairings sort,
      // pool[0] would be 'c' and this assertion would fail.
      expect(secondPairing!.userAId).toBe('a');
      expect(secondPairing!.userBId).toBe('b');
    });

    it('never double- or self-pairs across a pass over a larger pool', async () => {
      const { resolver, calls } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });

      const ratings = [1200, 1250, 1300, 1350, 1400, 1450, 1500];
      ratings.forEach((rating, index) => {
        service.enqueue(`u${index}`, rating, { name: `U${index}` });
      });

      await scheduler.fire();

      const seen = new Set<string>();
      for (const pairing of calls[0]!) {
        expect(pairing.userAId).not.toBe(pairing.userBId);
        expect(seen.has(pairing.userAId)).toBe(false);
        expect(seen.has(pairing.userBId)).toBe(false);
        seen.add(pairing.userAId);
        seen.add(pairing.userBId);
      }
    });
  });

  describe('K-trigger (maxPool)', () => {
    it('runs the pass immediately when the pool reaches maxPool, without waiting for the timer', async () => {
      const { resolver, calls } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 5000, maxPool: 2 });

      service.enqueue('a', 1500, { name: 'A' });
      expect(scheduler.pending).toBe(false); // lone waiter: not pairable yet, no timer armed

      const outcome = service.enqueue('b', 1520, { name: 'B' });
      expect(outcome).toEqual({ status: 'waiting' });

      // K reached: pass ran synchronously, no timer fire needed.
      await service.settled();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toHaveLength(1);
      expect(scheduler.pending).toBe(false);
    });

    it('cancels any pending timer when the K-trigger pass runs', async () => {
      const { resolver, calls } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 5000, maxPool: 3 });

      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1520, { name: 'B' });
      expect(scheduler.pending).toBe(true);
      expect(scheduler.scheduleCount).toBe(1);

      service.enqueue('c', 1000, { name: 'C' });
      await service.settled();

      expect(scheduler.pending).toBe(false);
      expect(calls).toHaveLength(1);
    });
  });

  describe('timer arm / re-arm', () => {
    it('arms a timer only when the pool becomes pairable (reaches 2), not on the first (lone) enqueue', () => {
      const { resolver } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 5000, maxPool: 8 });

      service.enqueue('a', 1500, { name: 'A' });
      expect(scheduler.pending).toBe(false);

      service.enqueue('b', 1520, { name: 'B' });
      expect(scheduler.pending).toBe(true);
      expect(scheduler.pendingMs).toBe(5000);
    });

    it('does not arm a second timer while one is already pending', () => {
      const { resolver } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 5000, maxPool: 8 });

      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1520, { name: 'B' });
      expect(scheduler.scheduleCount).toBe(1);

      service.enqueue('c', 1000, { name: 'C' });
      expect(scheduler.scheduleCount).toBe(1);
    });

    it('does not re-arm after a pass leaves an odd leftover (pool size 1, not pairable)', async () => {
      const { resolver } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });

      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1510, { name: 'B' });
      service.enqueue('c', 1490, { name: 'C' });

      await scheduler.fire();

      expect(scheduler.pending).toBe(false);
    });

    it('re-arms once the pool becomes pairable again after a pass', async () => {
      const { resolver } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });

      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1510, { name: 'B' });
      service.enqueue('c', 1490, { name: 'C' });

      await scheduler.fire();
      expect(scheduler.pending).toBe(false);

      // A fourth joiner makes the leftover + joiner pairable again.
      service.enqueue('d', 1505, { name: 'D' });
      expect(scheduler.pending).toBe(true);
    });

    it('re-arms after failPairing restores both entries, making the pool pairable again', async () => {
      const { calls } = recordingResolver();
      const serviceBox: { current?: ReturnType<typeof createQueueService> } = {};
      const resolver = vi.fn(async (pairings: Pairing[]) => {
        calls.push(pairings);
        // Simulate resolveMatch rejecting: the resolver's own contract is
        // to catch and call failPairing, never let this reject upward.
        serviceBox.current!.failPairing(pairings[0]!);
      });
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });
      serviceBox.current = service;

      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1510, { name: 'B' });

      await scheduler.fire();
      expect(service.getStatus('a')).toEqual({ status: 'waiting' });
      expect(service.getStatus('b')).toEqual({ status: 'waiting' });
      // Both restored -> pool size 2 again -> pairable -> timer re-armed.
      expect(scheduler.pending).toBe(true);
    });
  });

  describe('failure restore (both-restore)', () => {
    it('restores BOTH entries to waiting when the resolver fails a pairing, unlike the #57 A-only restore', async () => {
      const { resolver, calls } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });

      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1500, { name: 'B' });

      await scheduler.fire();
      const [pairing] = calls[0]!;

      expect(service.dequeue('a')).toBe('resolving');

      service.failPairing(pairing!);

      expect(service.getStatus('a')).toEqual({ status: 'waiting' });
      expect(service.getStatus('b')).toEqual({ status: 'waiting' });
    });

    it('a restored pairing can be re-paired by a subsequent pass', async () => {
      const { resolver, calls } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });

      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1500, { name: 'B' });
      await scheduler.fire();
      const [pairing] = calls[0]!;
      service.failPairing(pairing!);

      service.enqueue('c', 1500, { name: 'C' });
      expect(scheduler.pending).toBe(true);
      await scheduler.fire();

      expect(calls).toHaveLength(2);
      expect(calls[1]).toHaveLength(1);
      const rePaired = new Set([calls[1]![0]!.userAId, calls[1]![0]!.userBId]);
      expect(rePaired.has('a') || rePaired.has('b')).toBe(true);
    });
  });

  describe('dequeue', () => {
    it('removes a waiting user: 204-equivalent "removed"', () => {
      const { resolver } = recordingResolver();
      const service = createQueueService({ resolver, scheduler: createManualScheduler() });
      service.enqueue('a', 1500, { name: 'A' });
      expect(service.dequeue('a')).toBe('removed');
      expect(service.getStatus('a')).toEqual({ status: 'idle' });
    });

    it('reports not-queued for a user who never queued', () => {
      const { resolver } = recordingResolver();
      const service = createQueueService({ resolver, scheduler: createManualScheduler() });
      expect(service.dequeue('nobody')).toBe('not-queued');
    });

    it('reports resolving for a user mid-pairing, refusing to remove them', async () => {
      const { resolver } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });
      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1500, { name: 'B' });
      await scheduler.fire();
      expect(service.dequeue('a')).toBe('resolving');
      expect(service.dequeue('b')).toBe('resolving');
    });

    it('reports not-queued for a matched-but-unclaimed user', async () => {
      const { resolver, calls } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 100, maxPool: 8 });
      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1500, { name: 'B' });
      await scheduler.fire();
      const [pairing] = calls[0]!;
      const result = { version: 2, seed: 1, winner: 'A' as const, eventLog: [], hash: 123 };
      service.completePairing(pairing!, 'match-1', result);
      expect(service.dequeue('a')).toBe('not-queued');
    });

    it('cancels the pending batching-window timer when dequeue drops the pool below 2 (no longer pairable)', () => {
      const { resolver } = recordingResolver();
      const scheduler = createManualScheduler();
      const service = createQueueService({ resolver, scheduler, windowMs: 5000, maxPool: 8 });

      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1520, { name: 'B' });
      expect(scheduler.pending).toBe(true);
      expect(scheduler.scheduleCount).toBe(1);

      expect(service.dequeue('a')).toBe('removed');
      // Only 'b' remains: not pairable, so no timer should still be pending.
      expect(scheduler.pending).toBe(false);

      // Re-enqueuing to make the pool pairable again arms a fresh window,
      // not a leftover/shortened one from before the dequeue.
      service.enqueue('c', 1000, { name: 'C' });
      expect(scheduler.pending).toBe(true);
      expect(scheduler.pendingMs).toBe(5000);
      expect(scheduler.scheduleCount).toBe(2);
    });
  });
});
