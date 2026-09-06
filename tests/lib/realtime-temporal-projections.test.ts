import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { clearCache, getCachedDashboardMetrics } from '@/lib/realtime-cache';
import { getWidgetRealtimeProjection } from '@/lib/widget-data-provider';

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe('realtime temporal projections', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearCache();
  });

  afterEach(() => vi.useRealTimers());

  it('moves an incident into the SLA warning window without an incident write', async () => {
    vi.mocked(prisma.incident.findMany).mockResolvedValue([
      {
        id: 'incident-1',
        title: 'Temporal SLA',
        status: 'OPEN',
        urgency: 'HIGH',
        createdAt: new Date('2026-09-05T00:00:00.000Z'),
        acknowledgedAt: null,
        serviceId: 'service-1',
        assigneeId: null,
        priority: null,
        slaAckTargetMs: 20 * 60_000,
        slaResolveTargetMs: 120 * 60_000,
        slaPauses: [],
        service: { name: 'API', targetAckMinutes: 20, targetResolveMinutes: 120 },
      },
    ] as never);

    vi.setSystemTime(new Date('2026-09-05T00:04:00.000Z'));
    expect((await getWidgetRealtimeProjection()).slaBreachAlerts).toHaveLength(0);
    vi.setSystemTime(new Date('2026-09-05T00:06:00.000Z'));
    expect((await getWidgetRealtimeProjection()).slaBreachAlerts).toHaveLength(1);
  });

  it('ages resolved24h out when a reconciliation epoch changes the cache key', async () => {
    vi.mocked(prisma.incident.groupBy).mockResolvedValue([]);
    vi.mocked(prisma.incident.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    vi.setSystemTime(new Date('2026-09-05T00:00:00.000Z'));
    const before = await getCachedDashboardMetrics(
      'admin-1',
      'ADMIN',
      [],
      undefined,
      'reconcile:1'
    );
    vi.setSystemTime(new Date('2026-09-05T00:01:00.000Z'));
    const after = await getCachedDashboardMetrics('admin-1', 'ADMIN', [], undefined, 'reconcile:2');

    expect(before?.data.resolved).toBe(1);
    expect(after?.data.resolved).toBe(0);
    expect(prisma.incident.count).toHaveBeenCalledTimes(4);
  });
});
