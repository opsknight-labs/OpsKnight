import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calculateSLAMetrics: vi.fn(),
  calculateSLAMetricsFromRollups: vi.fn(),
  tryAdvisoryLock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { $transaction: async (fn: (tx: unknown) => unknown) => fn({}) },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/sla-server', () => ({
  calculateSLAMetrics: mocks.calculateSLAMetrics,
  calculateSLAMetricsFromRollups: mocks.calculateSLAMetricsFromRollups,
}));
vi.mock('@/lib/retention-policy', () => ({
  getRetentionPolicy: async () => ({ realTimeWindowDays: 90 }),
  getQueryDateBounds: async (start: Date, end: Date) => ({ start, end, isClipped: false }),
}));
vi.mock('@/lib/db-locks', () => ({
  tryAdvisoryLock: mocks.tryAdvisoryLock,
  LOCK_KEYS: { DRIFT_DETECTION: 1 },
}));

import { runSLADriftDetection } from '@/lib/sla-drift-detection';

const metrics = (over: Record<string, number | null> = {}) => ({
  totalIncidents: 100,
  highUrgencyCount: 10,
  mediumUrgencyCount: 10,
  lowUrgencyCount: 10,
  ackBreaches: 10,
  resolveBreaches: 10,
  mttr: 100,
  autoResolvedCount: 10,
  ...over,
});

describe('runSLADriftDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tryAdvisoryLock.mockResolvedValue(true);
  });

  it('applies the configured tolerance to every compared field', async () => {
    // 3% apart on total incidents (103 vs 100): outside the 1% default, inside a 10% tolerance.
    mocks.calculateSLAMetrics.mockResolvedValue(metrics({ totalIncidents: 103 }));
    mocks.calculateSLAMetricsFromRollups.mockResolvedValue(metrics());

    const strict = await runSLADriftDetection();
    expect(strict.samples.find(s => s.field === 'totalIncidents')?.withinTolerance).toBe(false);

    const lenient = await runSLADriftDetection({ toleranceFraction: 0.1 });
    expect(lenient.samples.every(s => s.withinTolerance)).toBe(true);
    expect(lenient.withinTolerance).toBe(true);
  });
});
