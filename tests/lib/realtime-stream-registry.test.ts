import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeRealtimeStreamCount,
  drainRealtimeStreams,
  isRealtimeDraining,
  registerRealtimeStream,
  resetRealtimeStreamRegistryForTests,
} from '@/lib/realtime-stream-registry';

describe('realtime stream registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRealtimeStreamRegistryForTests();
  });
  afterEach(() => {
    resetRealtimeStreamRegistryForTests();
    vi.useRealTimers();
  });

  it('tracks open streams and forgets them when they unregister', () => {
    const stop = registerRealtimeStream('signal', vi.fn());
    registerRealtimeStream('full', vi.fn());
    expect(activeRealtimeStreamCount()).toBe(2);
    stop();
    expect(activeRealtimeStreamCount()).toBe(1);
  });

  it('refuses new streams and closes every open stream within the spread window on drain', async () => {
    const closers = Array.from({ length: 20 }, () => vi.fn());
    closers.forEach(close => registerRealtimeStream('signal', close));
    expect(isRealtimeDraining()).toBe(false);
    expect(drainRealtimeStreams(3_000)).toBe(20);
    expect(isRealtimeDraining()).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    for (const close of closers) expect(close).toHaveBeenCalledExactlyOnceWith('shutdown');
    // Closing is spread out, not simultaneous.
    const closedAt = new Set<number>();
    resetRealtimeStreamRegistryForTests();
    const stamps: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      registerRealtimeStream('signal', () => stamps.push(Date.now()));
    }
    const start = Date.now();
    drainRealtimeStreams(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    stamps.forEach(stamp => closedAt.add(stamp - start));
    expect(closedAt.size).toBeGreaterThan(5);
  });
});
