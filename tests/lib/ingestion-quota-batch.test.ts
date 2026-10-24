import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { batchQuotaDecision, type QuotaDecision } from '@/lib/ingestion/quota-batch';

const allowed: QuotaDecision = { allowed: true, remaining: 1, resetAt: 1, count: 1 };

describe('bounded quota decision coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete globalThis.opsknightIngestionQuotaBatch;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.opsknightIngestionQuotaBatch;
  });

  it('waits for the shared database result and preserves each partial grant', async () => {
    let finish!: (decisions: QuotaDecision[]) => void;
    const decide = vi.fn(
      () =>
        new Promise<QuotaDecision[]>(resolve => {
          finish = resolve;
        })
    );
    const completed = vi.fn();
    const first = batchQuotaDecision('same', decide).then(completed);
    const second = batchQuotaDecision('same', decide);
    await vi.advanceTimersByTimeAsync(2);
    expect(decide).toHaveBeenCalledExactlyOnceWith(2);
    expect(completed).not.toHaveBeenCalled();
    const denied = { ...allowed, allowed: false, remaining: 0 };
    finish([allowed, denied]);
    await first;
    await expect(second).resolves.toEqual(denied);
    expect(completed).toHaveBeenCalledWith(allowed);
  });

  it('bounds outstanding callers while a database is hung, then recovers its capacity', async () => {
    const releases: Array<() => void> = [];
    const decide = vi.fn(
      (count: number) =>
        new Promise<QuotaDecision[]>(resolve => {
          releases.push(() => resolve(Array.from({ length: count }, () => allowed)));
        })
    );
    const pending = Array.from({ length: 1024 }, () => batchQuotaDecision('storm', decide));
    await vi.advanceTimersByTimeAsync(2);
    expect(decide).toHaveBeenCalledTimes(32);
    expect(decide.mock.calls.every(([count]) => count <= 32)).toBe(true);
    await expect(batchQuotaDecision('other', decide)).rejects.toThrow(
      'Shared ingestion quota busy'
    );
    releases.forEach(release => release());
    await Promise.all(pending);
    await vi.runAllTimersAsync();
    const recovered = batchQuotaDecision('other', async () => [allowed]);
    await vi.advanceTimersByTimeAsync(2);
    await expect(recovered).resolves.toEqual(allowed);
  });

  it('rejects every affected caller on database failure and isolates independent keys', async () => {
    const failure = new Error('database unavailable');
    const bad = [
      batchQuotaDecision('bad', async () => {
        throw failure;
      }),
      batchQuotaDecision('bad', async () => {
        throw failure;
      }),
    ];
    const result = Promise.allSettled(bad);
    const good = batchQuotaDecision('good', async () => [allowed]);
    await vi.advanceTimersByTimeAsync(2);
    expect(await result).toEqual(bad.map(() => ({ status: 'rejected', reason: failure })));
    await expect(good).resolves.toEqual(allowed);
  });
});
