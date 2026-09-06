import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({ groupBy: vi.fn(), count: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { incident: { groupBy: prisma.groupBy, count: prisma.count } },
}));

import { getDashboardRealtimeMetrics } from '@/lib/dashboard/dashboard-realtime-metrics';
import { clearCache } from '@/lib/realtime-cache';

const scopedActor = {
  id: 'user-1',
  role: 'USER' as const,
  status: 'ACTIVE' as const,
  teamIds: ['team-1'],
};

describe('filtered dashboard realtime metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
    prisma.groupBy.mockResolvedValue([
      { status: 'OPEN', urgency: 'HIGH', _count: { _all: 2 } },
      { status: 'ACKNOWLEDGED', urgency: 'LOW', _count: { _all: 1 } },
    ]);
    prisma.count.mockResolvedValue(1);
  });

  it('applies canonical authorization and dashboard filters', async () => {
    await expect(
      getDashboardRealtimeMetrics(scopedActor, { service: 'service-a', search: 'api' }, '42')
    ).resolves.toMatchObject({ open: 2, acknowledged: 1, active: 3, highUrgency: 2 });
    expect(prisma.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ OR: expect.any(Array) }),
            expect.objectContaining({ serviceId: 'service-a', OR: expect.any(Array) }),
          ]),
        }),
      })
    );
  });

  it('shares equivalent global scopes while isolating scoped actors', async () => {
    const admin = { ...scopedActor, id: 'admin-1', role: 'ADMIN' as const, teamIds: [] };
    await getDashboardRealtimeMetrics(admin, { service: 'service-a' }, '42');
    await getDashboardRealtimeMetrics({ ...admin, id: 'admin-2' }, { service: 'service-a' }, '42');
    expect(prisma.groupBy).toHaveBeenCalledTimes(1);
    clearCache();
    await getDashboardRealtimeMetrics(scopedActor, { service: 'service-a' }, '42');
    await getDashboardRealtimeMetrics(
      { ...scopedActor, id: 'user-2' },
      { service: 'service-a' },
      '42'
    );
    expect(prisma.groupBy).toHaveBeenCalledTimes(3);
  });
});
