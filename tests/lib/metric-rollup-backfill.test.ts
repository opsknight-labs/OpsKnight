import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
  serviceFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    incidentMetricRollup: { findFirst: mocks.findFirst, deleteMany: mocks.deleteMany },
    service: { findMany: mocks.serviceFindMany },
    $transaction: vi.fn(async () => undefined),
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/retention-policy', () => ({
  getRetentionPolicy: vi.fn().mockResolvedValue({
    metricsRetentionDays: 3650,
    businessHoursTimeZone: 'UTC',
  }),
}));

import { backfillRollups } from '@/lib/metric-rollup';

describe('backfillRollups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serviceFindMany.mockResolvedValue([{ id: 'svc-ok' }, { id: 'svc-bad' }]);
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockImplementation(async (args: { where: { serviceId: string | null } }) => {
      if (args.where.serviceId === 'svc-bad') throw new Error('rollup query timed out');
      return null;
    });
  });

  it('reports the service rollups that failed and the days they belong to', async () => {
    const summary = await backfillRollups(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-02T00:00:00Z')
    );

    expect(summary).toEqual({ days: 2, failures: 2, failedDays: ['2026-01-01', '2026-01-02'] });
  });

  it('reports no failures when every service rollup succeeds', async () => {
    mocks.serviceFindMany.mockResolvedValue([{ id: 'svc-ok' }]);
    mocks.findFirst.mockResolvedValue(null);

    const summary = await backfillRollups(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-01T00:00:00Z')
    );

    expect(summary).toEqual({ days: 1, failures: 0, failedDays: [] });
  });
});
