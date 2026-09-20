import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rollupFindFirst: vi.fn(),
  rollupCount: vi.fn(),
  rollupFindMany: vi.fn(),
  serviceFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    incidentMetricRollup: {
      findFirst: mocks.rollupFindFirst,
      count: mocks.rollupCount,
      findMany: mocks.rollupFindMany,
    },
    service: { findMany: mocks.serviceFindMany },
  },
}));
vi.mock('@/lib/retention-policy', () => ({
  getRetentionPolicy: vi.fn(async () => ({ metricsRetentionDays: 1 })),
}));

import { getRollupCoverage } from '@/lib/metric-rollup';

describe('rollup coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    vi.clearAllMocks();
  });

  afterEach(() => vi.useRealTimers());

  it('does not report a globally materialized day as covered when a service rollup is missing', async () => {
    const day = new Date('2026-09-18T00:00:00Z');
    mocks.rollupFindFirst.mockResolvedValue({ date: day });
    mocks.rollupCount.mockResolvedValue(1);
    mocks.rollupFindMany
      .mockResolvedValueOnce([{ date: day }])
      .mockResolvedValueOnce([{ date: day, serviceId: 'service-a' }]);
    mocks.serviceFindMany.mockResolvedValue([
      { id: 'service-a', createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'service-b', createdAt: new Date('2026-01-01T00:00:00Z') },
    ]);

    const coverage = await getRollupCoverage();

    expect(coverage.daysCovered).toBe(0);
    expect(coverage.coveragePercent).toBe(0);
  });
});
