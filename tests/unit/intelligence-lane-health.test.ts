import { describe, expect, it } from 'vitest';
import { LANE_STALE_AFTER_MS, evaluateLaneHealth } from '@/lib/intelligence/metrics';
import type { LaneStatus } from '@/lib/intelligence/jobs/runner';

const NOW = Date.parse('2026-01-01T00:00:00Z');
const result = (status: string) => ({
  status,
  criticalLagMs: 0,
  discovered: 0,
  claimed: 0,
  completed: 0,
  requeued: 0,
  failed: 0,
});
const status = (overrides: Partial<LaneStatus>): LaneStatus =>
  ({
    running: true,
    lastCycleAt: new Date(NOW - 1000),
    lastResult: result('idle'),
    paused: false,
    totals: { cycles: 1, claimed: 0, completed: 0, requeued: 0, failed: 0 },
    ...overrides,
  }) as LaneStatus;

describe('evaluateLaneHealth', () => {
  it('is healthy while cycling', () => {
    expect(evaluateLaneHealth(status({}), NOW)).toEqual({ status: 'healthy' });
  });

  it('is healthy before the first cycle completes', () => {
    expect(evaluateLaneHealth(status({ lastCycleAt: null, lastResult: null }), NOW)).toEqual({
      status: 'healthy',
    });
  });

  it('is disabled when not running or switched off, and never counts against readiness', () => {
    expect(evaluateLaneHealth(status({ running: false }), NOW)).toEqual({
      status: 'disabled',
      expected: false,
    });
    expect(evaluateLaneHealth(status({ lastResult: result('disabled') as never }), NOW)).toEqual({
      status: 'disabled',
      expected: false,
    });
  });

  it('reports a crashed lane thread as degraded while it restarts, even if it last saw intelligence off', () => {
    const thread = {
      state: 'restarting' as const,
      restarts: 1,
      startedAt: null,
      lastExit: 'Lane thread exited with code 1',
    };
    for (const lastResult of [result('idle'), result('disabled')])
      expect(evaluateLaneHealth(status({ thread, lastResult: lastResult as never }), NOW)).toEqual({
        status: 'degraded',
        error: 'Lane thread stopped unexpectedly; restarting it',
      });
    expect(evaluateLaneHealth(status({ thread: { ...thread, state: 'running' } }), NOW)).toEqual({
      status: 'healthy',
    });
    expect(
      evaluateLaneHealth(status({ running: false, thread: { ...thread, state: 'stopped' } }), NOW)
    ).toEqual({
      status: 'disabled',
      expected: false,
    });
  });

  it('reports degraded, never unhealthy, when paused or wedged', () => {
    expect(evaluateLaneHealth(status({ paused: true }), NOW).status).toBe('degraded');
    const stale = evaluateLaneHealth(
      status({ lastCycleAt: new Date(NOW - LANE_STALE_AFTER_MS - 1) }),
      NOW
    );
    expect(stale).toMatchObject({ status: 'degraded' });
    // Messages are fixed strings; nothing dynamic can leak.
    expect((stale as { error: string }).error).toBe('Lane has not completed a cycle recently');
  });

  it('judges a lane that never completed a cycle from the moment it started', () => {
    const justStarted = status({
      lastCycleAt: null,
      lastResult: null,
      startedAt: new Date(NOW - 1000),
    });
    expect(evaluateLaneHealth(justStarted, NOW)).toEqual({ status: 'healthy' });
    const wedgedFromStart = status({
      lastCycleAt: null,
      lastResult: null,
      startedAt: new Date(NOW - LANE_STALE_AFTER_MS - 1),
    });
    expect(evaluateLaneHealth(wedgedFromStart, NOW)).toEqual({
      status: 'degraded',
      error: 'Lane has not completed a cycle recently',
    });
  });

  it('reports degraded while timed-out work holds every concurrency slot', () => {
    expect(evaluateLaneHealth(status({ saturated: true }), NOW)).toEqual({
      status: 'degraded',
      error: 'Timed-out work is still holding database connections; new work is deferred',
    });
  });

  it('is degraded with a fixed reason when an integrated lane fell back to the main thread', () => {
    expect(evaluateLaneHealth(status({ fallbackReason: 'bundle-missing' }), NOW)).toEqual({
      status: 'degraded',
      error:
        'Lane runs in-process because the lane thread bundle is missing; ingestion latency is outside its contract',
    });
    expect(evaluateLaneHealth(status({ fallbackReason: 'disabled-by-env' }), NOW)).toEqual({
      status: 'degraded',
      error:
        'Lane runs in-process because INTELLIGENCE_LANE_THREAD=off; ingestion latency is outside its contract',
    });
    // In-process without a fallback (worker roles) stays healthy.
    expect(evaluateLaneHealth(status({ mode: 'in-process', fallbackReason: null }), NOW)).toEqual({
      status: 'healthy',
    });
  });

  it('keeps a disabled lane disabled, and more urgent reasons first, in fallback mode', () => {
    expect(
      evaluateLaneHealth(
        status({ fallbackReason: 'bundle-missing', lastResult: result('disabled') as never }),
        NOW
      )
    ).toEqual({ status: 'disabled', expected: false });
    expect(
      evaluateLaneHealth(status({ fallbackReason: 'bundle-missing', paused: true }), NOW)
    ).toMatchObject({ status: 'degraded', error: expect.stringContaining('Paused') });
  });

  it('is disabled while the lane thread is parked for a disabled install', () => {
    expect(
      evaluateLaneHealth(
        status({
          lastResult: null,
          thread: { state: 'parked', restarts: 0, startedAt: null, lastExit: null },
        }),
        NOW
      )
    ).toEqual({ status: 'disabled', expected: false });
  });
});
