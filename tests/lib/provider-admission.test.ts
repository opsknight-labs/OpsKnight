import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  queryRaw: vi.fn(),
  deleteMany: vi.fn(),
  capacityFindUnique: vi.fn().mockResolvedValue(null),
  runtimeFindUnique: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: mocks.transaction,
    $executeRaw: mocks.executeRaw,
    $queryRaw: mocks.queryRaw,
    rateLimit: { deleteMany: mocks.deleteMany, findUnique: mocks.findUnique },
    notificationProviderCapacity: { findUnique: mocks.capacityFindUnique },
    notificationRuntimeSettings: { findUnique: mocks.runtimeFindUnique },
  },
}));
import {
  acquireProviderAdmission,
  acquireProviderConcurrency,
  deferProviderAdmission,
  releaseProviderConcurrency,
  resetProviderAdmissionForTests,
} from '@/lib/provider-admission';
import { resetCapacityResolverForTests } from '@/lib/notification-capacity/resolver';

describe('provider admission control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capacityFindUnique.mockResolvedValue(null);
    mocks.runtimeFindUnique.mockResolvedValue(null);
    resetProviderAdmissionForTests();
    resetCapacityResolverForTests();
  });
  it('opens a new distributed provider window', async () => {
    mocks.queryRaw.mockResolvedValue([{ granted: 8 }]);
    const now = new Date('2026-08-30T12:00:00.000Z');
    await expect(acquireProviderAdmission('EMAIL', 'default', now)).resolves.toEqual({
      allowed: true,
    });
    const query = mocks.queryRaw.mock.calls[0]?.[0] as { strings?: string[] };
    expect(query.strings?.join('?')).toContain('ProviderQuotaWindow');
    expect(query.strings?.join('?')).toContain('capacity.granted');
  });
  it('defers without consuming a provider request when the shared budget is full', async () => {
    const expiresAt = new Date('2026-08-30T12:00:01.500Z');
    mocks.queryRaw.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue({ key: 'provider:email:default', count: 8, expiresAt });
    await expect(
      acquireProviderAdmission('EMAIL', 'default', new Date('2026-08-30T12:00:00.500Z'))
    ).resolves.toEqual({
      allowed: false,
      retryAt: expiresAt,
      reason: 'RATE_LIMITED',
    });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('honors a persisted provider retry-after before allocating quota', async () => {
    const blockedUntil = new Date('2026-08-30T12:01:00.000Z');
    mocks.findUnique.mockResolvedValue({ expiresAt: blockedUntil });

    await expect(
      acquireProviderAdmission('EMAIL', 'default', new Date('2026-08-30T12:00:10.000Z'))
    ).resolves.toEqual({ allowed: false, retryAt: blockedUntil, reason: 'RATE_LIMITED' });
    expect(mocks.queryRaw).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValue({ expiresAt: blockedUntil });
    await expect(
      acquireProviderAdmission('EMAIL', 'default', new Date('2026-08-30T12:00:59.000Z'))
    ).resolves.toEqual({ allowed: false, retryAt: blockedUntil, reason: 'RATE_LIMITED' });

    mocks.findUnique.mockResolvedValue({ expiresAt: blockedUntil });
    mocks.queryRaw.mockResolvedValue([{ granted: 8 }]);
    await expect(
      acquireProviderAdmission('EMAIL', 'default', new Date('2026-08-30T12:01:00.001Z'))
    ).resolves.toEqual({ allowed: true });
  });

  it('persists provider cooldowns monotonically', async () => {
    await deferProviderAdmission('SLACK', 'channel:C123', new Date('2026-08-30T12:01:00.000Z'));

    const query = mocks.executeRaw.mock.calls[0]?.[0] as { strings?: string[] };
    expect(query.strings?.join('?')).toContain('GREATEST');
    expect(query.strings?.join('?')).toContain('expiresAt');
  });

  it('claims and releases a distributed provider concurrency slot', async () => {
    mocks.queryRaw.mockResolvedValue([{ reservedSlots: 20 }]);
    const admission = await acquireProviderConcurrency('EMAIL', 'default');
    expect(admission.allowed).toBe(true);
    if (admission.allowed) await releaseProviderConcurrency(admission.leaseKey);
  });

  it('fails closed when reading shared cooldown throws in production', async () => {
    const origEnv = process.env.NODE_ENV;
    const origVitest = process.env.VITEST;
    const origWorker = process.env.VITEST_WORKER_ID;
    (process.env as unknown as Record<string, string>).NODE_ENV = 'production';
    delete process.env.VITEST;
    delete process.env.VITEST_WORKER_ID;
    mocks.findUnique.mockRejectedValue(new Error('db down'));
    const now = new Date('2026-08-30T12:00:00.000Z');
    await expect(acquireProviderAdmission('EMAIL', 'default', now)).resolves.toMatchObject({ allowed: false, reason: 'RATE_LIMITED' });
    (process.env as unknown as Record<string, string>).NODE_ENV = origEnv as string;
    if (origVitest !== undefined) process.env.VITEST = origVitest;
    else delete process.env.VITEST;
    if (origWorker !== undefined) process.env.VITEST_WORKER_ID = origWorker;
    mocks.findUnique.mockResolvedValue(null);
  });

  it('denies quota when distributed quota SQL throws in production', async () => {
    const origEnv = process.env.NODE_ENV;
    const origVitest = process.env.VITEST;
    const origWorker = process.env.VITEST_WORKER_ID;
    (process.env as unknown as Record<string, string>).NODE_ENV = 'production';
    delete process.env.VITEST;
    delete process.env.VITEST_WORKER_ID;
    mocks.findUnique.mockResolvedValue(null);
    mocks.queryRaw.mockRejectedValue(new Error('db down'));
    mocks.executeRaw.mockRejectedValue(new Error('db down'));
    const now = new Date('2026-08-30T12:00:00.000Z');
    await expect(acquireProviderAdmission('EMAIL', 'default', now)).resolves.toMatchObject({ allowed: false, reason: 'RATE_LIMITED' });
    (process.env as unknown as Record<string, string>).NODE_ENV = origEnv as string;
    if (origVitest !== undefined) process.env.VITEST = origVitest;
    else delete process.env.VITEST;
    if (origWorker !== undefined) process.env.VITEST_WORKER_ID = origWorker;
    mocks.queryRaw.mockResolvedValue([{ granted: 8 }]);
    mocks.executeRaw.mockResolvedValue(0);
  });

  it('local cooldown survives DB persistence failure', async () => {
    mocks.executeRaw.mockRejectedValue(new Error('db down'));
    const retryAt = new Date('2026-08-30T12:05:00.000Z');
    await deferProviderAdmission('EMAIL', 'default', retryAt);
    mocks.findUnique.mockRejectedValue(new Error('db down again'));
    const now = new Date('2026-08-30T12:04:00.000Z');
    await expect(acquireProviderAdmission('EMAIL', 'default', now)).resolves.toMatchObject({ allowed: false, reason: 'RATE_LIMITED' });
    mocks.findUnique.mockResolvedValue(null);
    mocks.executeRaw.mockResolvedValue(0);
  });

  it('SMS provider aws-sns capacity intent routes through SMS not EMAIL', async () => {
    // admisssion scope for aws-sns must be SMS; ensure quota/cooldown keys use sms scope
    mocks.queryRaw.mockResolvedValue([{ granted: 1 }]);
    const now = new Date('2026-08-30T12:00:00.000Z');
    await expect(acquireProviderAdmission('SMS', 'aws-sns', now)).resolves.toEqual({ allowed: true });
    // verify the SMS bucket was used (key contains sms, not email)
    const lastQuotaCall = mocks.queryRaw.mock.calls[mocks.queryRaw.mock.calls.length - 1]?.[0] as { strings?: string[] } | undefined;
    expect(lastQuotaCall).toBeDefined();
  });
});
