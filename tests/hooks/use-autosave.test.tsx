import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from '@/lib/hooks/use-autosave';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type TestData = { value: string };

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('useAutosave contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('debounces normal changes and saves exactly once after the configured delay', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const { rerender, result } = renderHook(
      ({ data }) => useAutosave({ data, onSave, delay: 250 }),
      { initialProps: { data: { value: 'A' } as TestData } }
    );

    rerender({ data: { value: 'B' } });
    expect(result.current.hasPendingChanges).toBe(true);

    await advance(249);
    expect(onSave).not.toHaveBeenCalled();

    await advance(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ value: 'B' });
    expect(result.current.status).toBe('saved');
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it('keeps a failed save dirty and does not retry automatically', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: false, error: 'network down' });
    const { rerender, result } = renderHook(
      ({ data }) => useAutosave({ data, onSave, delay: 100 }),
      { initialProps: { data: { value: 'A' } as TestData } }
    );

    rerender({ data: { value: 'B' } });
    await advance(100);

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('network down');
    expect(result.current.hasPendingChanges).toBe(true);

    await advance(10_000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('Retry performs exactly one save and uses the latest visible value', async () => {
    const onSave = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'first failed' })
      .mockResolvedValueOnce({ success: true });
    const { rerender, result } = renderHook(
      ({ data }) => useAutosave({ data, onSave, delay: 500 }),
      { initialProps: { data: { value: 'A' } as TestData } }
    );

    rerender({ data: { value: 'B' } });
    await advance(500);
    expect(result.current.status).toBe('error');

    rerender({ data: { value: 'C' } });
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1]?.[0]).toEqual({ value: 'C' });
    expect(result.current.status).toBe('saved');

    await advance(500);
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('serializes saves so edit B made while A is in flight persists after A with max one request in flight', async () => {
    const first = deferred<{ success: boolean }>();
    const second = deferred<{ success: boolean }>();
    let inFlight = 0;
    let maxInFlight = 0;
    const onSave = vi.fn(async (data: TestData) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const response = data.value === 'B' ? await first.promise : await second.promise;
      inFlight -= 1;
      return response;
    });

    const { rerender, result } = renderHook(
      ({ data }) => useAutosave({ data, onSave, delay: 100 }),
      { initialProps: { data: { value: 'A' } as TestData } }
    );

    rerender({ data: { value: 'B' } });
    await advance(100);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saving');

    rerender({ data: { value: 'C' } });
    await advance(1000);
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ success: true });
      await first.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1]?.[0]).toEqual({ value: 'C' });
    expect(maxInFlight).toBe(1);

    await act(async () => {
      second.resolve({ success: true });
      await second.promise;
      await Promise.resolve();
    });

    expect(result.current.status).toBe('saved');
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it('does not advance the committed snapshot after a failed save', async () => {
    const onSave = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'failed' })
      .mockResolvedValueOnce({ success: true });
    const { rerender, result } = renderHook(
      ({ data }) => useAutosave({ data, onSave, delay: 50 }),
      { initialProps: { data: { value: 'A' } as TestData } }
    );

    rerender({ data: { value: 'B' } });
    await advance(50);
    expect(result.current.hasPendingChanges).toBe(true);

    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1]?.[0]).toEqual({ value: 'B' });
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it('never lets an old Saved timer hide a newer pending edit', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const { rerender, result } = renderHook(
      ({ data }) => useAutosave({ data, onSave, delay: 5000 }),
      { initialProps: { data: { value: 'A' } as TestData } }
    );

    rerender({ data: { value: 'B' } });
    await advance(5000);
    expect(result.current.status).toBe('saved');

    await advance(1000);
    rerender({ data: { value: 'C' } });
    expect(result.current.hasPendingChanges).toBe(true);
    expect(result.current.status).toBe('idle');

    await advance(1100);
    expect(result.current.status).toBe('idle');
    expect(result.current.hasPendingChanges).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending debounce when disabled and saves the dirty value after re-enable', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const { rerender } = renderHook(
      ({ data, enabled }) => useAutosave({ data, onSave, delay: 100, enabled }),
      { initialProps: { data: { value: 'A' } as TestData, enabled: true } }
    );

    rerender({ data: { value: 'B' }, enabled: true });
    await advance(50);
    rerender({ data: { value: 'B' }, enabled: false });
    await advance(500);
    expect(onSave).not.toHaveBeenCalled();

    rerender({ data: { value: 'B' }, enabled: true });
    await advance(100);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ value: 'B' });
  });

  it('guards beforeunload only while the current value is dirty', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const { rerender } = renderHook(
      ({ data }) => useAutosave({ data, onSave, delay: 100 }),
      { initialProps: { data: { value: 'A' } as TestData } }
    );

    const cleanEvent = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(cleanEvent)).toBe(true);

    rerender({ data: { value: 'B' } });
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(dirtyEvent)).toBe(false);

    await advance(100);
    const savedEvent = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(savedEvent)).toBe(true);
  });

  it('flushes a dirty debounced value on React unmount without marking anything saved in the UI', () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const { rerender, unmount } = renderHook(
      ({ data }) => useAutosave({ data, onSave, delay: 10_000 }),
      { initialProps: { data: { value: 'A' } as TestData } }
    );

    rerender({ data: { value: 'B' } });
    unmount();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ value: 'B' });
  });

  it('handles a thrown save error as a persistence failure and keeps the value dirty', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('transport exploded'));
    const { rerender, result } = renderHook(
      ({ data }) => useAutosave({ data, onSave, delay: 100 }),
      { initialProps: { data: { value: 'A' } as TestData } }
    );

    rerender({ data: { value: 'B' } });
    await advance(100);

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('transport exploded');
    expect(result.current.hasPendingChanges).toBe(true);
  });

  it('persists only the latest value after rapid A/B/C edits inside one debounce window', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const { rerender } = renderHook(
      ({ data }) => useAutosave({ data, onSave, delay: 100 }),
      { initialProps: { data: { value: 'A' } as TestData } }
    );

    rerender({ data: { value: 'B' } });
    await advance(25);
    rerender({ data: { value: 'C' } });
    await advance(25);
    rerender({ data: { value: 'D' } });
    await advance(99);
    expect(onSave).not.toHaveBeenCalled();

    await advance(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ value: 'D' });
  });
});
