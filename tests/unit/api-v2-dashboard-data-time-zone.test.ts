import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dashboardFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  calculate: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: {
    dashboard: { findFirst: mocks.dashboardFindFirst },
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock('@/lib/api-v2/dashboards', () => ({ dashboardReadWhere: () => ({}) }));
vi.mock('@/lib/api-v2/rbac', () => ({ enforceV2Authorization: vi.fn() }));
vi.mock('@/lib/actor-metrics', () => ({ calculateActorSLAMetrics: mocks.calculate }));
vi.mock('@/lib/sla', () => ({ serializeSlaMetrics: (metrics: unknown) => metrics }));

import { readDashboardData } from '@/lib/api-v2/dashboard-data';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const actor: AuthorizationActor = {
  id: 'user-1',
  role: 'RESPONDER',
  status: 'ACTIVE',
  teamIds: [],
};

describe('readDashboardData time zone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dashboardFindFirst.mockResolvedValue({ id: 'dash-1', config: { timeRange: 7 } });
    mocks.calculate.mockResolvedValue({ totalIncidents: 3 });
  });

  it("buckets the metrics in the key owner's profile time zone, as the dashboard page does", async () => {
    mocks.userFindUnique.mockResolvedValue({ timeZone: 'Asia/Kolkata' });

    await readDashboardData(actor, 'dash-1', {});

    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { timeZone: true },
    });
    expect(mocks.calculate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ windowDays: 7, userTimeZone: 'Asia/Kolkata' })
    );
  });
});
