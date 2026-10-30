import { describe, expect, it } from 'vitest';
import { LANE_STALE_AFTER_MS, evaluateLaneHealth } from '@/lib/intelligence/metrics';
import type { LaneStatus } from '@/lib/intelligence/jobs/runner';

const NOW = Date.parse('2026-01-01T00:00:00Z');
const result = (status: string) => ({ status, criticalLagMs: 0, discovered: 0, claimed: 0, completed: 0, requeued: 0, failed: 0 });
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
    expect(evaluateLaneHealth(status({ lastCycleAt: null, lastResult: null }), NOW)).toEqual({ status: 'healthy' });
  });

  it('is disabled when not running or switched off, and never counts against readiness', () => {
    expect(evaluateLaneHealth(status({ running: false }), NOW)).toEqual({ status: 'disabled', expected: false });
    expect(evaluateLaneHealth(status({ lastResult: result('disabled') as never }), NOW)).toEqual({
      status: 'disabled',
      expected: false,
    });
  });

  it('reports degraded, never unhealthy, when paused or wedged', () => {
    expect(evaluateLaneHealth(status({ paused: true }), NOW).status).toBe('degraded');
    const stale = evaluateLaneHealth(status({ lastCycleAt: new Date(NOW - LANE_STALE_AFTER_MS - 1) }), NOW);
    expect(stale).toMatchObject({ status: 'degraded' });
    // Messages are fixed strings; nothing dynamic can leak.
    expect((stale as { error: string }).error).toBe('Lane has not completed a cycle recently');
  });
});
