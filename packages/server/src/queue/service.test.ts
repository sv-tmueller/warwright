import { describe, expect, it } from 'vitest';
import { createQueueService, selectOpponent, type WaitingEntry } from './service.js';

function entry(overrides: Partial<WaitingEntry> = {}): WaitingEntry {
  return {
    userId: 'user-default',
    rating: 1500,
    build: { name: 'default' },
    enqueuedAt: 0,
    ...overrides,
  };
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
    const service = createQueueService();
    const outcome = service.enqueue('a', 1500, { name: 'A' });
    expect(outcome.status).toBe('waiting');
    expect(service.getStatus('a')).toEqual({ status: 'waiting' });
  });

  it('reports idle for a user who never queued', () => {
    const service = createQueueService();
    expect(service.getStatus('nobody')).toEqual({ status: 'idle' });
  });

  it('pairs a second, closer-rated player with the first: waiting player becomes A, joiner becomes B', () => {
    const service = createQueueService();
    service.enqueue('a', 1500, { name: 'A' });
    const outcome = service.enqueue('b', 1520, { name: 'B' });

    expect(outcome.status).toBe('paired');
    if (outcome.status !== 'paired') throw new Error('expected paired');
    expect(outcome.pairing.userAId).toBe('a');
    expect(outcome.pairing.userBId).toBe('b');
    expect(outcome.pairing.buildA).toEqual({ name: 'A' });
    expect(outcome.pairing.buildB).toEqual({ name: 'B' });
  });

  it('rejects a double-enqueue from the same waiting user with an already-queued status (409 source)', () => {
    const service = createQueueService();
    service.enqueue('a', 1500, { name: 'A' });
    const second = service.enqueue('a', 1500, { name: 'A again' });
    expect(second.status).toBe('already-queued');
  });

  it('never self-pairs: a lone user enqueuing twice stays waiting, not paired', () => {
    const service = createQueueService();
    service.enqueue('a', 1500, { name: 'A' });
    const second = service.enqueue('a', 1500, { name: 'A again' });
    expect(second.status).not.toBe('paired');
  });

  it('retains a matched result until claimed, and clears it on the next enqueue', () => {
    const service = createQueueService();
    service.enqueue('a', 1500, { name: 'A' });
    const outcome = service.enqueue('b', 1500, { name: 'B' });
    if (outcome.status !== 'paired') throw new Error('expected paired');

    const result = { version: 2, seed: 1, winner: 'A' as const, eventLog: [], hash: 123 };
    service.completePairing(outcome.pairing, 'match-1', result);

    // Retained across repeated GETs.
    expect(service.getStatus('a')).toEqual({ status: 'matched', matchId: 'match-1', result });
    expect(service.getStatus('a')).toEqual({ status: 'matched', matchId: 'match-1', result });
    expect(service.getStatus('b')).toEqual({ status: 'matched', matchId: 'match-1', result });

    // A new enqueue clears the stale unclaimed result.
    service.enqueue('a', 1500, { name: 'A' });
    expect(service.getStatus('a')).toEqual({ status: 'waiting' });
  });

  it('restores the opponent at the head of the queue when resolution fails, and the joiner is left idle', () => {
    const service = createQueueService();
    service.enqueue('a', 1500, { name: 'A' });
    const outcome = service.enqueue('b', 1500, { name: 'B' });
    if (outcome.status !== 'paired') throw new Error('expected paired');

    // Both are transiently "resolving" and dequeue must reject that state.
    expect(service.dequeue('a')).toBe('resolving');

    service.failPairing(outcome.pairing);

    // A is restored to waiting.
    expect(service.getStatus('a')).toEqual({ status: 'waiting' });
    // B (the failed caller) is not re-queued; they're back to idle.
    expect(service.getStatus('b')).toEqual({ status: 'idle' });

    // A can be paired again by a new joiner.
    const rePaired = service.enqueue('c', 1500, { name: 'C' });
    expect(rePaired.status).toBe('paired');
    if (rePaired.status !== 'paired') throw new Error('expected paired');
    expect(rePaired.pairing.userAId).toBe('a');
    expect(rePaired.pairing.userBId).toBe('c');
  });

  describe('dequeue', () => {
    it('removes a waiting user: 204-equivalent "removed"', () => {
      const service = createQueueService();
      service.enqueue('a', 1500, { name: 'A' });
      expect(service.dequeue('a')).toBe('removed');
      expect(service.getStatus('a')).toEqual({ status: 'idle' });
    });

    it('reports not-queued for a user who never queued', () => {
      const service = createQueueService();
      expect(service.dequeue('nobody')).toBe('not-queued');
    });

    it('reports resolving for a user mid-pairing, refusing to remove them', () => {
      const service = createQueueService();
      service.enqueue('a', 1500, { name: 'A' });
      service.enqueue('b', 1500, { name: 'B' });
      expect(service.dequeue('a')).toBe('resolving');
      expect(service.dequeue('b')).toBe('resolving');
    });

    it('reports not-queued for a matched-but-unclaimed user', () => {
      const service = createQueueService();
      service.enqueue('a', 1500, { name: 'A' });
      const outcome = service.enqueue('b', 1500, { name: 'B' });
      if (outcome.status !== 'paired') throw new Error('expected paired');
      const result = { version: 2, seed: 1, winner: 'A' as const, eventLog: [], hash: 123 };
      service.completePairing(outcome.pairing, 'match-1', result);
      expect(service.dequeue('a')).toBe('not-queued');
    });
  });
});
