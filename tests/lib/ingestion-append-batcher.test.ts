import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableAppendBatcher } from '@/lib/ingestion/append-batcher';

afterEach(() => vi.useRealTimers());

describe('durable append group bounds', () => {
  it('keeps requests unresolved until commit and preserves per-caller results', async () => {
    vi.useFakeTimers();
    let complete!: (values: number[]) => void;
    const commit = vi.fn(
      () =>
        new Promise<number[]>(resolve => {
          complete = resolve;
        })
    );
    const batcher = new DurableAppendBatcher<number, number>(commit);
    let settled = false;
    const first = batcher.enqueue(1, 10).then(value => {
      settled = true;
      return value;
    });
    const second = batcher.enqueue(2, 10);
    await vi.advanceTimersByTimeAsync(2);
    expect(commit).toHaveBeenCalledWith([1, 2]);
    expect(settled).toBe(false);
    complete([11, 12]);
    expect(await Promise.all([first, second])).toEqual([11, 12]);
  });

  it('bounds inflight groups and includes their callers in the pending limit', async () => {
    vi.useFakeTimers();
    const releases: Array<(values: number[]) => void> = [];
    const commit = vi.fn(
      (values: number[]) =>
        new Promise<number[]>(resolve => {
          releases.push(() => resolve(values));
        })
    );
    const batcher = new DurableAppendBatcher<number, number>(commit);
    const pending = Array.from({ length: 256 }, (_, value) => batcher.enqueue(value, 10));
    await expect(batcher.enqueue(257, 10)).rejects.toThrow('busy');
    await vi.advanceTimersByTimeAsync(2);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls.every(([values]) => values.length <= 32)).toBe(true);
    await expect(batcher.enqueue(258, 10)).rejects.toThrow('busy');
    for (let index = 0; index < 8; index++) {
      releases.at(index)!([]);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(await Promise.all(pending)).toEqual(Array.from({ length: 256 }, (_, value) => value));
  });

  it('bounds retained bytes and releases them after failed commits', async () => {
    vi.useFakeTimers();
    const commit = vi.fn(async () => {
      throw new Error('database offline');
    });
    const batcher = new DurableAppendBatcher<number, number>(commit);
    const pending = Array.from({ length: 8 }, (_, value) =>
      batcher.enqueue(value, 4 * 1024 * 1024).catch(error => error.message)
    );
    await expect(batcher.enqueue(9, 1)).rejects.toThrow('busy');
    await vi.advanceTimersByTimeAsync(2);
    expect(await Promise.all(pending)).toEqual(Array(8).fill('database offline'));
    const retry = batcher.enqueue(10, 1).catch(error => error.message);
    await vi.advanceTimersByTimeAsync(2);
    expect(await retry).toBe('database offline');
  });
});
