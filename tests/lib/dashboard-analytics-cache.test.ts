import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calculate: vi.fn(),
  generation: vi.fn().mockResolvedValue('42'),
  tryLock: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/actor-metrics', () => ({ calculateActorSLAMetrics: mocks.calculate }));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: mocks.transaction } }));
vi.mock('@/lib/db-locks', () => ({ tryAdvisoryLock: mocks.tryLock }));
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
    mocks.generation.mockResolvedValue('42');
    // The lock is granted and held for the whole callback, as a real transaction would.
    mocks.tryLock.mockResolvedValue(true);
    mocks.transaction.mockImplementation(async (callback: (tx: object) => Promise<unknown>) =>
      callback({})
    );
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

  it('lets a different cold key wait for the heavy-query slot instead of failing', async () => {
    let finishFirst!: (value: typeof metrics) => void;
    mocks.calculate.mockReturnValueOnce(new Promise(resolve => (finishFirst = resolve)));
    mocks.calculate.mockResolvedValueOnce(metrics);
    const first = getDashboardAnalytics(actor, { rangeDays: 30 });
    const second = getDashboardAnalytics(actor, { rangeDays: 7 });
    await vi.waitFor(() => expect(mocks.calculate).toHaveBeenCalledOnce());

    finishFirst(metrics);

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.calculate).toHaveBeenCalledTimes(2);
  });

  it('rejects a cold key that waits longer than the queue limit', async () => {
    vi.useFakeTimers();
    try {
      mocks.calculate.mockReturnValue(new Promise(() => undefined));
      void getDashboardAnalytics(actor, { rangeDays: 30 });
      const waiting = getDashboardAnalytics(actor, { rangeDays: 7 });
      const outcome = expect(waiting).rejects.toBeInstanceOf(DashboardAnalyticsUnavailableError);
      await vi.advanceTimersByTimeAsync(10_000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects at once when the wait queue is full', async () => {
    mocks.calculate.mockReturnValue(new Promise(() => undefined));
    void getDashboardAnalytics(actor, { rangeDays: 1 }).catch(() => undefined);
    for (let days = 2; days <= 9; days += 1) {
      void getDashboardAnalytics(actor, { rangeDays: days }).catch(() => undefined);
    }
    await expect(getDashboardAnalytics(actor, { rangeDays: 10 })).rejects.toBeInstanceOf(
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
  describe('across replicas', () => {
    const FRESH_MS = 30_000;

    it('computes only while holding the advisory lock for that entry', async () => {
      const order: string[] = [];
      mocks.tryLock.mockImplementation(async () => {
        order.push('lock');
        return true;
      });
      mocks.calculate.mockImplementation(async () => {
        order.push('compute');
        return metrics;
      });

      await getDashboardAnalytics(actor, { rangeDays: 30 });
      await getDashboardAnalytics(actor, { rangeDays: 7 });

      expect(order).toEqual(['lock', 'compute', 'lock', 'compute']);
      const keys = mocks.tryLock.mock.calls.map(call => (call as [unknown, bigint])[1]);
      expect(typeof keys[0]).toBe('bigint');
      expect(keys[0]).not.toBe(keys[1]);
      resetDashboardAnalyticsCacheForTests();
      await getDashboardAnalytics(actor, { rangeDays: 30 });
      expect((mocks.tryLock.mock.calls[2] as [unknown, bigint])[1]).toBe(keys[0]);
    });

    it('serves the stale value instead of recomputing while another replica holds the lock', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        mocks.calculate.mockResolvedValue(metrics);
        await getDashboardAnalytics(actor, { rangeDays: 30 });
        vi.setSystemTime(Date.now() + FRESH_MS + 1);
        mocks.tryLock.mockResolvedValue(false);

        const result = await getDashboardAnalytics(actor, { rangeDays: 30 });
        await vi.waitFor(() => expect(mocks.tryLock).toHaveBeenCalledTimes(2));

        expect(result.freshness).toBe('stale');
        expect(mocks.calculate).toHaveBeenCalledOnce();

        // Once the other replica has released the lock, the next request refreshes it.
        await new Promise(resolve => setTimeout(resolve, 0));
        mocks.tryLock.mockResolvedValue(true);
        await getDashboardAnalytics(actor, { rangeDays: 30 });
        await vi.waitFor(() => expect(mocks.calculate).toHaveBeenCalledTimes(2));
      } finally {
        vi.useRealTimers();
      }
    });

    it('lets a cold key wait for the other replica and then compute under the lock', async () => {
      vi.useFakeTimers();
      try {
        mocks.tryLock.mockResolvedValueOnce(false).mockResolvedValue(true);
        mocks.calculate.mockResolvedValue(metrics);

        const pending = getDashboardAnalytics(actor, { rangeDays: 30 });
        await vi.advanceTimersByTimeAsync(250);
        const result = await pending;

        expect(result.freshness).toBe('fresh');
        expect(mocks.tryLock).toHaveBeenCalledTimes(2);
        expect(mocks.calculate).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it('computes for itself when the other replica is still busy after a few seconds', async () => {
      vi.useFakeTimers();
      try {
        mocks.tryLock.mockResolvedValue(false);
        mocks.calculate.mockResolvedValue(metrics);

        const pending = getDashboardAnalytics(actor, { rangeDays: 30 });
        await vi.advanceTimersByTimeAsync(3_000);
        await expect(pending).resolves.toMatchObject({ freshness: 'fresh' });

        expect(mocks.calculate).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it('computes locally when the lock query fails', async () => {
      mocks.tryLock.mockRejectedValue(new Error('connection reset'));
      mocks.calculate.mockResolvedValue(metrics);

      await expect(getDashboardAnalytics(actor, { rangeDays: 30 })).resolves.toMatchObject({
        freshness: 'fresh',
      });
      expect(mocks.calculate).toHaveBeenCalledOnce();
    });

    it('reports a failed computation once and frees the process slot', async () => {
      mocks.calculate.mockRejectedValueOnce(new Error('query failed'));
      await expect(getDashboardAnalytics(actor, { rangeDays: 30 })).rejects.toThrow('query failed');
      expect(mocks.calculate).toHaveBeenCalledOnce();

      mocks.calculate.mockResolvedValue(metrics);
      await expect(getDashboardAnalytics(actor, { rangeDays: 7 })).resolves.toBeDefined();
    });

    it('keeps the result when only closing the lock transaction fails', async () => {
      mocks.calculate.mockResolvedValue(metrics);
      mocks.transaction.mockImplementation(async (callback: (tx: object) => Promise<unknown>) => {
        await callback({});
        throw new Error('Transaction already closed');
      });

      await expect(getDashboardAnalytics(actor, { rangeDays: 30 })).resolves.toMatchObject({
        mtta: 4,
      });
      expect(mocks.calculate).toHaveBeenCalledOnce();
    });
  });
});
