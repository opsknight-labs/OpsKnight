import { describe, expect, it } from 'vitest';
import {
  KIND_BREAKER_MIN_FAILURES,
  KIND_BREAKER_PAUSE_MS,
  KIND_BREAKER_WINDOW_MS,
  KindBreaker,
} from '@/lib/intelligence/jobs/kind-breaker';
import { reconnectDelayMs, LISTENER_RECONNECT_MAX_MS } from '@/lib/intelligence/jobs/wake-listener';

const T0 = Date.parse('2026-01-01T00:00:00Z');

describe('per-kind work breaker', () => {
  it('trips only once a kind fails often enough and mostly, then pauses that kind alone', () => {
    const breaker = new KindBreaker();
    for (let i = 0; i < KIND_BREAKER_MIN_FAILURES - 1; i += 1) {
      expect(breaker.record('INDEX_INCIDENT', false, T0 + i)).toBeNull();
    }
    expect(breaker.pausedKinds(T0)).toEqual([]);
    expect(breaker.record('INDEX_INCIDENT', false, T0 + 10)).toBe('paused');
    expect(breaker.pausedKinds(T0 + 11)).toEqual(['INDEX_INCIDENT']);
    expect(breaker.isPaused('ANALYZE_INCIDENT', T0 + 11)).toBe(false);
    // Further failures while paused do not re-trip or extend the pause.
    expect(breaker.record('INDEX_INCIDENT', false, T0 + 12)).toBeNull();
    expect(breaker.isPaused('INDEX_INCIDENT', T0 + KIND_BREAKER_PAUSE_MS + 10)).toBe(false);
    expect(breaker.pausedKinds(T0 + KIND_BREAKER_PAUSE_MS + 11)).toEqual([]);
  });

  it('does not trip a kind that mostly succeeds, even with many failures', () => {
    const breaker = new KindBreaker();
    for (let i = 0; i < 20; i += 1) breaker.record('ANALYZE_INCIDENT', true, T0 + i);
    for (let i = 0; i < 10; i += 1) {
      expect(breaker.record('ANALYZE_INCIDENT', false, T0 + 100 + i)).toBeNull();
    }
    expect(breaker.pausedKinds(T0 + 200)).toEqual([]);
  });

  it('forgets failures older than its window', () => {
    const breaker = new KindBreaker();
    for (let i = 0; i < KIND_BREAKER_MIN_FAILURES - 1; i += 1)
      breaker.record('EMBED_PENDING', false, T0 + i);
    expect(breaker.record('EMBED_PENDING', false, T0 + KIND_BREAKER_WINDOW_MS + 1)).toBeNull();
  });
});

describe('wake listener reconnect backoff', () => {
  it('grows with each attempt, is jittered, and is capped', () => {
    const lowest = (attempt: number) => reconnectDelayMs(attempt, () => 0);
    const highest = (attempt: number) => reconnectDelayMs(attempt, () => 0.999999);
    expect(lowest(0)).toBe(500);
    expect(highest(0)).toBeLessThanOrEqual(1000);
    expect(lowest(3)).toBeGreaterThan(lowest(1));
    expect(highest(50)).toBeLessThanOrEqual(LISTENER_RECONNECT_MAX_MS);
    expect(lowest(50)).toBeGreaterThanOrEqual(LISTENER_RECONNECT_MAX_MS / 2);
  });
});
