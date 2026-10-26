import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { batchQuotaDecision, type QuotaDecision } from '@/lib/ingestion/quota-batch';

const allowed: QuotaDecision = { allowed: true, remaining: 1, resetAt: 1, count: 1 };

describe('bounded quota decision coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete globalThis.opsknightIngestionQuotaBatchV2;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.opsknightIngestionQuotaBatchV2;
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
    expect(decide).toHaveBeenCalledExactlyOnceWith(['same', 'same']);
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
      (keys: readonly string[]) =>
        new Promise<QuotaDecision[]>(resolve => {
          releases.push(() => resolve(Array.from({ length: keys.length }, () => allowed)));
        })
    );
    const pending = Array.from({ length: 1024 }, () => batchQuotaDecision('storm', decide));
    await vi.advanceTimersByTimeAsync(2);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls.every(([keys]) => keys.length <= 32)).toBe(true);
    await expect(batchQuotaDecision('other', decide)).rejects.toThrow(
      'Shared ingestion quota busy'
    );
    while (globalThis.opsknightIngestionQuotaBatchV2!.pending) {
      releases.splice(0).forEach(release => release());
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(decide).toHaveBeenCalledTimes(32);
    await Promise.all(pending);
    await vi.runAllTimersAsync();
    const recovered = batchQuotaDecision('other', async () => [allowed]);
    await vi.advanceTimersByTimeAsync(2);
    await expect(recovered).resolves.toEqual(allowed);
  });

  it('rejects every affected caller on database failure and recovers for later batches', async () => {
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
    await vi.advanceTimersByTimeAsync(2);
    expect(await result).toEqual(bad.map(() => ({ status: 'rejected', reason: failure })));
    const good = batchQuotaDecision('good', async () => [allowed]);
    await vi.advanceTimersByTimeAsync(2);
    await expect(good).resolves.toEqual(allowed);
  });
  it('coalesces distinct keys and returns decisions in caller order', async () => {
    const denied = { ...allowed, allowed: false, remaining: 0 };
    const decide = vi.fn(async () => [allowed, denied, allowed]);
    const results = ['first', 'second', 'first'].map(key => batchQuotaDecision(key, decide));
    await vi.advanceTimersByTimeAsync(2);
    expect(decide).toHaveBeenCalledExactlyOnceWith(['first', 'second', 'first']);
    expect(await Promise.all(results)).toEqual([allowed, denied, allowed]);
  });

  it.each(['synchronous failure', 'missing decision'])('releases capacity after %s', async mode => {
    const decide = () => {
      if (mode === 'synchronous failure') throw new Error('unavailable');
      return Promise.resolve([]);
    };
    const pending = batchQuotaDecision('key', decide);
    const outcome = Promise.allSettled([pending]);
    await vi.advanceTimersByTimeAsync(2);
    expect((await outcome)[0].status).toBe('rejected');
    expect(globalThis.opsknightIngestionQuotaBatchV2!.pending).toBe(0);
    expect(globalThis.opsknightIngestionQuotaBatchV2!.active).toBe(0);
    const recovered = batchQuotaDecision('key', async () => [allowed]);
    await vi.advanceTimersByTimeAsync(2);
    await expect(recovered).resolves.toEqual(allowed);
  });

});
