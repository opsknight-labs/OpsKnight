import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calculate: vi.fn(),
  generation: vi.fn().mockResolvedValue('42'),
}));

vi.mock('@/lib/actor-metrics', () => ({ calculateActorSLAMetrics: mocks.calculate }));
vi.mock('@/lib/realtime-change-control-plane', () => ({
  getRealtimeChangeGeneration: mocks.generation,
}));

import {
  DashboardAnalyticsUnavailableError,
  getDashboardAnalytics,
  resetDashboardAnalyticsCacheForTests,
} from '@/lib/dashboard/dashboard-analytics-cache';

const actor = {
  id: 'user-1',
  role: 'USER' as const,
  status: 'ACTIVE' as const,
  teamIds: ['team-1'],
};
const metrics = {
  mttd: 4,
  mttr: 20,
  ackCompliance: 95,
  resolveCompliance: 90,
  heatmapData: [{ date: '2026-09-06', count: 2 }],
  serviceMetrics: [],
  assigneeLoad: [],
  effectiveStart: new Date('2026-08-01T00:00:00Z'),
  effectiveEnd: new Date('2026-09-01T00:00:00Z'),
  isClipped: false,
  retentionDays: 90,
};

describe('dashboard analytics cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDashboardAnalyticsCacheForTests();
  });

  it('singleflights identical cold requests', async () => {
    let finish!: (value: typeof metrics) => void;
    mocks.calculate.mockReturnValue(new Promise(resolve => (finish = resolve)));
    const first = getDashboardAnalytics(actor, { rangeDays: 30 });
    const second = getDashboardAnalytics(actor, { rangeDays: 30 });
    finish(metrics);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.calculate).toHaveBeenCalledOnce();
  });

  it('rejects a different cold key while heavy-query capacity is occupied', async () => {
    mocks.calculate.mockReturnValue(new Promise(() => undefined));
    void getDashboardAnalytics(actor, { rangeDays: 30 });
    await expect(getDashboardAnalytics(actor, { rangeDays: 7 })).rejects.toBeInstanceOf(
      DashboardAnalyticsUnavailableError
    );
  });

  it('keeps authorization scopes in separate entries', async () => {
    mocks.calculate.mockResolvedValue(metrics);
    await getDashboardAnalytics(actor, { rangeDays: 30 });
    await getDashboardAnalytics({ ...actor, id: 'user-2' }, { rangeDays: 30 });
    expect(mocks.calculate).toHaveBeenCalledTimes(2);
  });

  it('singleflights equivalent organization-wide actors', async () => {
    let finish!: (value: typeof metrics) => void;
    mocks.calculate.mockReturnValue(new Promise(resolve => (finish = resolve)));
    const first = getDashboardAnalytics(
      { ...actor, id: 'admin-1', role: 'ADMIN', teamIds: [] },
      { rangeDays: 30 }
    );
    const second = getDashboardAnalytics(
      { ...actor, id: 'responder-1', role: 'RESPONDER', teamIds: ['team-2'] },
      { rangeDays: 30 }
    );
    finish(metrics);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.calculate).toHaveBeenCalledOnce();
  });
});
