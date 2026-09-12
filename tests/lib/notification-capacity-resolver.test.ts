import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capacityFindUnique: vi.fn().mockResolvedValue(null),
  runtimeFindUnique: vi.fn().mockResolvedValue(null),
  runtimeFindMany: vi.fn(),
  capacityFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    notificationProviderCapacity: { findUnique: mocks.capacityFindUnique, findMany: mocks.capacityFindMany },
    notificationRuntimeSettings: { findUnique: mocks.runtimeFindUnique },
    $transaction: vi.fn().mockImplementation((cb: (tx: any) => unknown) => cb({})),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    rateLimit: { findUnique: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { getEffectiveCapacity, getEffectiveWatermarks, resetCapacityResolverForTests } from '@/lib/notification-capacity/resolver';
import { capacityCache, runtimeCache } from '@/lib/notification-capacity/cache';

describe('notification capacity resolver regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capacityFindUnique.mockResolvedValue(null);
    mocks.runtimeFindUnique.mockResolvedValue(null);
    resetCapacityResolverForTests();
    capacityCache.invalidate();
    runtimeCache.invalidate();
  });

  it('DB runtime beats env ceiling: per-field DB>env (ceiling/quotablock do not hijack DB bulkShare/adaptive)', async () => {
    // DB owns the capacity with bulkShare 50% and adaptive false.
    mocks.capacityFindUnique.mockResolvedValue({
      provider: 'default',
      channel: 'EMAIL',
      mode: 'CUSTOM',
      ratePerSecond: 100,
      maxInFlight: 20,
      bulkSharePercent: 50,
      adaptiveBackpressure: false,
      revision: 5,
      updatedAt: new Date(),
    });
    // Runtime DB row exists so resolver does not fall back to env bulkShare
    mocks.runtimeFindUnique.mockResolvedValue({
      id: 'default',
      bulkQueueLowWatermark: 5000,
      bulkQueueHighWatermark: 25000,
      defaultBulkSharePercent: 50,
      adaptiveBackpressure: false,
      revision: 1,
      updatedAt: new Date(),
    });
    const env = {
      NODE_ENV: 'test' as const,
      NOTIFICATION_EMAIL_RATE_PER_SECOND: '9999',
      NOTIFICATION_BULK_SHARE: '0.95',
      NOTIFICATION_ADAPTIVE_BACKPRESSURE: 'true',
      // Emergency infra clamps that must NOT manufacture bulkShare/adaptive env branch values
      NOTIFICATION_DEPLOYMENT_RATE_CEILING: '1000',
      NOTIFICATION_QUOTA_BLOCK_SIZE: '500',
    } as unknown as NodeJS.ProcessEnv;
    const effective = await getEffectiveCapacity({ channel: 'EMAIL', provider: 'default', env, nowMs: 1_000 });
    expect(effective.source).toBe('DATABASE');
    // DB bulkShare 50% preserved, not env default 80% / env 95%
    expect(effective.bulkShare).toBeCloseTo(0.5, 2);
    expect(effective.adaptiveBackpressure).toBe(false);
    expect(effective.bulkRatePerSecond).toBe(Math.max(1, Math.floor(effective.effectiveRatePerSecond * 0.5)));
  });

  it('per-field env: only capacity-relevant vars drive ENV branch — ceiling/quota alone stay DEFAULT', async () => {
    mocks.runtimeFindUnique.mockResolvedValue(null);
    const env = {
      NODE_ENV: 'test' as const,
      // No rate/inflight/bulkShare/adaptive — only infra clamps
      NOTIFICATION_DEPLOYMENT_RATE_CEILING: '1000',
      NOTIFICATION_QUOTA_BLOCK_SIZE: '200',
    } as unknown as NodeJS.ProcessEnv;
    const effective = await getEffectiveCapacity({ channel: 'EMAIL', provider: 'default', env, nowMs: 2_000 });
    expect(effective.source).toBe('DEFAULT');
    expect(effective.quotaBlockSize).toBe(200);
    // Ceiling still applies
    expect(effective.effectiveRatePerSecond).toBeLessThanOrEqual(1000);
  });

  it('cached DB null is not re-queried until TTL (negative cache)', async () => {
    mocks.runtimeFindUnique.mockResolvedValue(null);
    mocks.capacityFindUnique.mockResolvedValue(null);
    const t0 = 10_000;
    await getEffectiveCapacity({ channel: 'EMAIL', provider: 'default', nowMs: t0 });
    // runtimeFindUnique called once for negative cache
    expect(mocks.runtimeFindUnique).toHaveBeenCalledTimes(1);
    mocks.runtimeFindUnique.mockClear();
    mocks.capacityFindUnique.mockClear();
    // Within 5s TTL — should be cache hit, no DB query
    await getEffectiveCapacity({ channel: 'EMAIL', provider: 'default', nowMs: t0 + 1000 });
    expect(mocks.runtimeFindUnique).not.toHaveBeenCalled();
    expect(mocks.capacityFindUnique).not.toHaveBeenCalled();
    // After TTL expiry — re-queries
    await getEffectiveCapacity({ channel: 'EMAIL', provider: 'default', nowMs: t0 + 6000 });
    expect(mocks.runtimeFindUnique).toHaveBeenCalledTimes(1);
  });

  it('WEBHOOK/SLACK fallback: dynamic provider resolves to WEBHOOK:default / SLACK:default profile', async () => {
    // First call for WEBHOOK:https://hooks.example.com/a — no exact row
    mocks.capacityFindUnique
      .mockResolvedValueOnce(null) // WEBHOOK:https://hooks.example.com/a
      .mockResolvedValueOnce({
        provider: 'default',
        channel: 'WEBHOOK',
        mode: 'CUSTOM',
        ratePerSecond: 42,
        maxInFlight: 7,
        bulkSharePercent: 60,
        adaptiveBackpressure: true,
        revision: 3,
        updatedAt: new Date(),
      }); // fallback WEBHOOK:default
    mocks.runtimeFindUnique.mockResolvedValue(null);
    const e = await getEffectiveCapacity({ channel: 'WEBHOOK', provider: 'https://hooks.example.com/a', nowMs: 20_000 });
    expect(mocks.capacityFindUnique).toHaveBeenCalledTimes(2);
    expect(e.configuredRatePerSecond).toBe(42);
    expect(e.source).toBe('DATABASE');
    // Non-WEBHOOK/SLACK channel must NOT fallback
    mocks.capacityFindUnique.mockReset().mockResolvedValue(null);
    runtimeCache.invalidate();
    capacityCache.invalidate();
    mocks.runtimeFindUnique.mockResolvedValue(null);
    const e2 = await getEffectiveCapacity({ channel: 'EMAIL', provider: 'custom@origin', nowMs: 21_000 });
    expect(e2.source).toBe('DEFAULT');
  });

  it('getEffectiveWatermarks clamps DB values (defense in depth)', async () => {
    // Simulate bad manual DB edit beyond hard limits
    mocks.runtimeFindUnique.mockResolvedValue({
      id: 'default',
      bulkQueueLowWatermark: 9999999,
      bulkQueueHighWatermark: -1,
      defaultBulkSharePercent: 80,
      adaptiveBackpressure: true,
      revision: 2,
      updatedAt: new Date(),
    });
    const wm = await getEffectiveWatermarks({ nowMs: 30_000 });
    expect(wm.source).toBe('DATABASE');
    expect(wm.low).toBeGreaterThanOrEqual(100);
    expect(wm.low).toBeLessThanOrEqual(1_000_000);
    expect(wm.high).toBeGreaterThanOrEqual(1000);
    expect(wm.high).toBeLessThanOrEqual(1_000_000);
    // Order enforced
    expect(wm.high).toBeGreaterThanOrEqual(wm.low);
  });

  it('bulkSharePercent null falls back to runtime default (not hardcoded 80)', async () => {
    mocks.capacityFindUnique.mockResolvedValue({
      provider: 'default',
      channel: 'EMAIL',
      mode: 'AUTO',
      ratePerSecond: null,
      maxInFlight: null,
      bulkSharePercent: null,
      adaptiveBackpressure: true,
      revision: 1,
      updatedAt: new Date(),
    });
    mocks.runtimeFindUnique.mockResolvedValue({
      id: 'default',
      bulkQueueLowWatermark: 5000,
      bulkQueueHighWatermark: 25000,
      defaultBulkSharePercent: 33,
      adaptiveBackpressure: true,
      revision: 1,
      updatedAt: new Date(),
    });
    const e = await getEffectiveCapacity({ channel: 'EMAIL', provider: 'default', nowMs: 40_000 });
    expect(e.bulkShare).toBeCloseTo(0.33, 2);
  });
});
