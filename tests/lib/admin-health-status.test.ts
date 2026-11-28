import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  jobCount: vi.fn(),
  notificationCount: vi.fn(),
  queryRaw: vi.fn(async (_strings: TemplateStringsArray) => []),
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
    $queryRaw: m.queryRaw,
    $executeRaw: async () => 0,
    backgroundJob: {
      count: m.jobCount,
      findMany: async () => [],
      findFirst: async () => null,
    },
    notification: { count: m.notificationCount, findMany: async () => [] },
    notificationProvider: {
      findMany: async () => [{ provider: 'EMAIL', enabled: true, config: { host: 'smtp' } }],
    },
  };
  return {
    default: new Proxy(base, {
      get: (target, name) => Reflect.get(target, name) ?? model,
    }),
  };
});

import {
  calculateOperationalScore,
  JOB_FAILURES_UNHEALTHY_PER_HOUR,
  NOTIFICATIONS_STUCK_UNHEALTHY,
  backgroundJobsStatus,
  collectAdminHealth,
  notificationsStatus,
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
      backgroundJobsStatus({
        ...quiet,
        failedLastHour: JOB_FAILURES_UNHEALTHY_PER_HOUR,
      })
    ).toBe('unhealthy');
  });

  it('degrades for late pending work and is unhealthy for a stuck processing job', () => {
    expect(backgroundJobsStatus({ ...quiet, overdue: 1 })).toBe('degraded');
    expect(backgroundJobsStatus({ ...quiet, staleProcessing: 1 })).toBe('unhealthy');
  });
});

describe('notificationsStatus', () => {
  const quiet = { incompleteProviders: 0, stuck: 0, failed24h: 0 };

  it('degrades, not unhealthy, for one notification that is late', () => {
    expect(notificationsStatus({ ...quiet, stuck: 1 })).toBe('degraded');
  });

  it('turns unhealthy exactly at the stuck-notification threshold', () => {
    expect(
      notificationsStatus({
        ...quiet,
        stuck: NOTIFICATIONS_STUCK_UNHEALTHY - 1,
      })
    ).toBe('degraded');
    expect(notificationsStatus({ ...quiet, stuck: NOTIFICATIONS_STUCK_UNHEALTHY })).toBe(
      'unhealthy'
    );
  });

  it('keeps an enabled provider without configuration unhealthy, and failures degraded', () => {
    expect(notificationsStatus({ ...quiet, incompleteProviders: 1 })).toBe('unhealthy');
    expect(notificationsStatus({ ...quiet, failed24h: 3 })).toBe('degraded');
    expect(notificationsStatus(quiet)).toBe('healthy');
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

  it('does not count a notification held to a later attempt time as stuck', async () => {
    await collectAdminHealth({ force: true });

    const stuck = m.notificationCount.mock.calls
      .map(([args]) => args.where)
      .find(w => w.status === 'PENDING');
    expect(stuck).toHaveProperty('nextAttemptAt');
    expect(stuck).not.toHaveProperty('createdAt');
  });
});

describe('scheduler check when the internal cron is disabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetAdminHealthCacheForTests();
  });

  it('reports an external scheduler as informational instead of degrading the page', async () => {
    vi.stubEnv('ENABLE_INTERNAL_CRON', 'false');
    resetAdminHealthCacheForTests();
    m.jobCount.mockResolvedValue(0);
    m.notificationCount.mockResolvedValue(0);

    const report = await collectAdminHealth({ force: true });
    const scheduler = report.checks.find(check => check.id === 'scheduler');

    expect(scheduler?.status).toBe('informational');
    expect(scheduler?.summary).toContain('External scheduler');
    expect(calculateOperationalScore(scheduler ? [scheduler] : []).overall).toBe('healthy');
  });
});

describe('database capacity query', () => {
  it('counts only active transactions and client backends, and skips backup tools', async () => {
    resetAdminHealthCacheForTests();
    m.queryRaw.mockClear();
    await collectAdminHealth({ force: true });

    const sql = m.queryRaw.mock.calls
      .map(([strings]) => strings.join('?'))
      .find(text => text.includes('longTransactions'));
    expect(sql).toBeDefined();
    const longTransactions = sql?.slice(
      sql.indexOf('WHERE datname'),
      sql.indexOf('"longTransactions"')
    );
    expect(longTransactions).toContain("state = 'active'");
    expect(longTransactions).toContain("'pg_dump'");
    expect(longTransactions).toContain("'pg_basebackup'");
    expect(sql).toContain("backend_type = 'client backend'");
  });
});

describe('release check', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAdminHealthCacheForTests();
  });

  it('asks GitHub once across forced refreshes, including after a failed lookup', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    resetAdminHealthCacheForTests();

    await collectAdminHealth({ force: true });
    await collectAdminHealth({ force: true });
    await collectAdminHealth({ force: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
