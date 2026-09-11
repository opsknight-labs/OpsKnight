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
});
