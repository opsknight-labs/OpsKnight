import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  jobCount: vi.fn(),
  notificationCount: vi.fn(),
}));

// Every other query the health report makes answers "nothing there": those checks are not under test.
vi.mock('@/lib/prisma', () => {
  const model = new Proxy(
    {},
    {
      get: (_target, method) =>
        method === 'count'
          ? async () => 0
          : method === 'findMany'
            ? async () => []
            : async () => null,
    }
  );
  const base: Record<string, unknown> = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    backgroundJob: { count: m.jobCount, findMany: async () => [], findFirst: async () => null },
    notification: { count: m.notificationCount, findMany: async () => [] },
    notificationProvider: {
      findMany: async () => [{ provider: 'EMAIL', enabled: true, config: { host: 'smtp' } }],
    },
  };
  return {
    default: new Proxy(base, { get: (target, name) => Reflect.get(target, name) ?? model }),
  };
});

import {
  JOB_FAILURES_UNHEALTHY_PER_HOUR,
  backgroundJobsStatus,
  collectAdminHealth,
  resetAdminHealthCacheForTests,
} from '@/lib/admin-health';

describe('backgroundJobsStatus', () => {
  const quiet = { staleProcessing: 0, failedLastHour: 0, overdue: 0 };

  it('is healthy with nothing failing, late or stuck', () => {
    expect(backgroundJobsStatus(quiet)).toBe('healthy');
  });

  it('degrades, not unhealthy, for a single transient failure', () => {
    expect(backgroundJobsStatus({ ...quiet, failedLastHour: 1 })).toBe('degraded');
  });

  it('turns unhealthy exactly at the failure-rate threshold', () => {
    const below = JOB_FAILURES_UNHEALTHY_PER_HOUR - 1;
    expect(backgroundJobsStatus({ ...quiet, failedLastHour: below })).toBe('degraded');
    expect(
      backgroundJobsStatus({ ...quiet, failedLastHour: JOB_FAILURES_UNHEALTHY_PER_HOUR })
    ).toBe('unhealthy');
  });

  it('degrades for late pending work and is unhealthy for a stuck processing job', () => {
    expect(backgroundJobsStatus({ ...quiet, overdue: 1 })).toBe('degraded');
    expect(backgroundJobsStatus({ ...quiet, staleProcessing: 1 })).toBe('unhealthy');
  });
});

describe('what the health report counts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAdminHealthCacheForTests();
    m.jobCount.mockResolvedValue(0);
    m.notificationCount.mockResolvedValue(0);
  });

  it('counts only jobs more than 5 minutes late as overdue, and failures in the last hour', async () => {
    await collectAdminHealth({ force: true });

    const wheres = m.jobCount.mock.calls.map(([args]) => args.where);
    const overdue = wheres.find(w => w.status === 'PENDING' && w.scheduledAt);
    const failedRecent = wheres.filter(w => w.status === 'FAILED' && w.updatedAt);
    expect(Date.now() - overdue.scheduledAt.lt.getTime()).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    expect(failedRecent).toHaveLength(2);
    const windows = failedRecent
      .map(w => Date.now() - w.updatedAt.gte.getTime())
      .sort((a, b) => a - b);
    expect(windows[0]).toBeLessThanOrEqual(60 * 60_000 + 1000);
  });
});
